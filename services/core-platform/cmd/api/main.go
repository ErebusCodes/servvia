// Command api runs the Servvia Core Platform HTTP service.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"servvia/services/core-platform/internal/checks"
	"servvia/services/core-platform/internal/checks/checksapi"
	checkstore "servvia/services/core-platform/internal/checks/pgstore"
	"servvia/services/core-platform/internal/config"
	"servvia/services/core-platform/internal/devices"
	"servvia/services/core-platform/internal/devices/devicesapi"
	devicestore "servvia/services/core-platform/internal/devices/pgstore"
	"servvia/services/core-platform/internal/events"
	eventstore "servvia/services/core-platform/internal/events/pgstore"
	"servvia/services/core-platform/internal/health"
	"servvia/services/core-platform/internal/identity"
	"servvia/services/core-platform/internal/kitchen"
	"servvia/services/core-platform/internal/kitchen/kitchenapi"
	kitchenstore "servvia/services/core-platform/internal/kitchen/pgstore"
	"servvia/services/core-platform/internal/menu"
	"servvia/services/core-platform/internal/orders"
	"servvia/services/core-platform/internal/orders/ordersapi"
	orderstore "servvia/services/core-platform/internal/orders/pgstore"
	"servvia/services/core-platform/internal/payments"
	"servvia/services/core-platform/internal/payments/paymentsapi"
	paymentstore "servvia/services/core-platform/internal/payments/pgstore"
	"servvia/services/core-platform/internal/platform/postgres"
	"servvia/services/core-platform/internal/pricing/pgcatalog"
	"servvia/services/core-platform/internal/promotions"
	promotionstore "servvia/services/core-platform/internal/promotions/pgstore"
	"servvia/services/core-platform/internal/promotions/promotionsapi"
	"servvia/services/core-platform/internal/ratelimit"
	"servvia/services/core-platform/internal/realtime"
	realtimestore "servvia/services/core-platform/internal/realtime/pgstore"
	"servvia/services/core-platform/internal/realtime/realtimeapi"
	"servvia/services/core-platform/internal/refunds"
	"servvia/services/core-platform/internal/refunds/refundsapi"
	"servvia/services/core-platform/internal/server"
	"servvia/services/core-platform/internal/shifts"
	shiftstore "servvia/services/core-platform/internal/shifts/pgstore"
	"servvia/services/core-platform/internal/shifts/shiftsapi"
	"servvia/services/core-platform/internal/tables"
	"servvia/services/core-platform/internal/tables/pgstore"
	"servvia/services/core-platform/internal/tables/tablesapi"
	"servvia/services/core-platform/internal/venues"
	"servvia/services/core-platform/internal/workers"
	"servvia/services/core-platform/internal/workers/workersapi"
)

func main() {
	if err := run(); err != nil {
		slog.Error("core platform stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})).
		With("service", "servvia-core-platform")
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.NewPool(ctx, postgres.Options{
		URL: cfg.DatabaseURL, MaxConns: cfg.DBMaxConns, ReadOnly: cfg.DBReadOnly,
	})
	if err != nil {
		return err
	}
	defer pool.Close()

	// The same Redis as the NestJS API, so a client has one rate-limit budget
	// across both services. Connects lazily; a Redis outage fails rate-limited
	// routes closed (503), as in Nest.
	rdb := ratelimit.NewRedisClient(cfg.RedisHost, cfg.RedisPort)
	defer rdb.Close()

	venueStore := venues.NewPostgresStore(pool)
	// Table sessions are the first capability that writes. They are enabled
	// only when the pool is read-write (SERVVIA_CORE_DB_READ_ONLY=false);
	// otherwise changes answer 503 and reads still work.
	tableSessions := tables.NewService(pgstore.New(pool), !cfg.DBReadOnly)
	// Promotions (D11) are administered under the same switch. Canonical
	// orders write under it too, price with the D1 pricing authority, and
	// apply a named promotion at its evaluated version.
	promotionStore := promotionstore.New(pool)
	promotionService := promotions.NewService(promotionStore, !cfg.DBReadOnly)
	orderService := orders.NewService(orderstore.New(pool, func(err error) {
		logger.Warn("best-effort order audit write failed", "error", err)
	}), pgcatalog.New(pool), !cfg.DBReadOnly).WithPromotions(promotionStore, time.Now)

	// Kitchen tickets change under the same switch. The kitchen projection
	// is the kitchen_projector work consumer (D13): the generic worker
	// processes its order.round_submitted deliveries at least once. The
	// legacy D4 loop only drains OutboxEvent rows written before D13. Both
	// run only where writes are enabled and stop with the process (an
	// interrupted delivery rolls back and is released for another attempt).
	kitchenService := kitchen.NewService(kitchenstore.New(pool), !cfg.DBReadOnly)
	var bg sync.WaitGroup
	workerCtx, stopWorkers := context.WithCancel(context.Background())
	defer func() { stopWorkers(); bg.Wait() }()
	if !cfg.DBReadOnly {
		projector := kitchenstore.NewProjector(pool, kitchen.SingleStation{Name: kitchen.DefaultStation}, logger)
		kitchenWorker := workers.New(pool, events.KitchenProjector, projector, logger)
		bg.Add(2)
		go func() { defer bg.Done(); kitchenWorker.Run(workerCtx, cfg.KitchenPollInterval) }()
		go func() { defer bg.Done(); projector.Run(workerCtx, cfg.KitchenPollInterval) }()
	}

	// Checks write under the same switch.
	checkService := checks.NewService(checkstore.New(pool, func(err error) {
		logger.Warn("best-effort check audit write failed", "error", err)
	}), !cfg.DBReadOnly)

	// Payments write under the same switch. Card results come only from the
	// payment adapter, whose route exists only with its own secret; cash is
	// accounted to the tendering staff member's open shift (the shift
	// ledger, in the payment's transaction).
	paymentStore := paymentstore.New(pool, func(err error) {
		logger.Warn("best-effort payment audit write failed", "error", err)
	}, shiftstore.Ledger{})
	paymentService := payments.NewService(paymentStore, !cfg.DBReadOnly)
	// Refunds and reversals change payment balance and settlement in the same
	// transaction, so their repository is the payment store's.
	refundService := refunds.NewService(paymentStore.Adjustments(), !cfg.DBReadOnly)
	shiftService := shifts.NewService(shiftstore.New(pool), !cfg.DBReadOnly)
	// Devices and terminals: the permanent device registry. Device
	// credentials (the payment adapter's among them) are verified against it
	// on every request.
	deviceService := devices.NewService(devicestore.New(pool), !cfg.DBReadOnly, devicestore.NewID)

	// Realtime (D12): every committed canonical fact is tailed from the
	// DomainEvent log (D13) and fanned out to this process's subscribers. It
	// only reads, so it runs on a read-only pool too; pruning needs writes.
	hub := realtime.NewHub(realtime.DefaultBuffer)
	dispatcher := realtimestore.NewDispatcher(eventstore.NewLog(pool), hub, logger,
		cfg.RealtimePollInterval, cfg.EventRetention, !cfg.DBReadOnly)
	if err := dispatcher.Start(ctx); err != nil {
		return err
	}
	bg.Add(1)
	go func() { defer bg.Done(); dispatcher.Run(workerCtx) }()
	venueGrants := identity.NewPostgresVenueGrants(pool)
	realtimeHandler := realtimeapi.NewHandler(hub, identity.NewVerifier(cfg.JWTAccessSecret), identity.NewPostgresTabletDevices(pool),
		deviceService, venueStore, venueGrants, logger, realtimeapi.DefaultConfig)

	probes := health.New(pool, cfg.ReadinessTimeout)
	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: server.Routes(server.Deps{
			Logger:        logger,
			Health:        probes,
			Menu:          menu.NewHandler(menu.NewPostgresStore(pool), logger),
			Venues:        venues.NewHandler(venueStore, logger),
			TableSessions: tablesapi.NewHandler(tableSessions, venueStore, logger),
			Orders:        ordersapi.NewHandler(orderService, venueStore, logger),
			Promotions:    promotionsapi.NewHandler(promotionService, venueStore, logger),
			Kitchen:       kitchenapi.NewHandler(kitchenService, venueStore, logger),
			Checks:        checksapi.NewHandler(checkService, venueStore, logger),
			Payments:      paymentsapi.NewHandler(paymentService, venueStore, logger),
			Shifts:        shiftsapi.NewHandler(shiftService, venueStore, logger),
			Devices:       devicesapi.NewHandler(deviceService, venueStore, logger),
			Refunds:       refundsapi.NewHandler(refundService, venueStore, logger),
			Realtime:      realtimeHandler,
			Workers:       workersapi.NewHandler(pool, logger),
			DeviceAuth:    deviceService,
			Verifier:      identity.NewVerifier(cfg.JWTAccessSecret),
			TabletDevices: identity.NewPostgresTabletDevices(pool),
			VenueGrants:   venueGrants,
			RateLimiter:   ratelimit.New(rdb, cfg.TrustProxyHops, logger),
			SecureCookies: cfg.IsProduction(),
		}),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    1 << 20,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", cfg.HTTPAddr, "db_read_only", cfg.DBReadOnly, "env", cfg.Environment)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}

	// Graceful shutdown: stop advertising readiness, then let in-flight
	// requests finish within the shutdown timeout.
	logger.Info("shutting down")
	probes.Drain()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	// Realtime first: refuse new subscriptions and close the open ones
	// (1001 going away); hijacked WebSockets are not tracked by Shutdown.
	realtimeHandler.Drain(shutdownCtx)
	logger.Info("realtime closed")
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Info("stopped")
	return nil
}
