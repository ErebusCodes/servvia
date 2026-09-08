using System;

namespace VerduraIdealposBridge.Orders.NativeTable
{
    /// <summary>
    /// The native stale-timeout rule, as a pure function so the invariant is
    /// directly testable in CI (OrderLifecycleWatcher.ObserveNative is
    /// vendor-coupled and cannot be).
    ///
    /// The clock is anchored to the order's DURABLE submission timestamp
    /// (OrderRecord.SubmittedAtUtc, persisted TEXT NOT NULL in the SQLite
    /// state store), never to process start or an in-memory timer. Two
    /// consequences the tests pin down:
    ///   * a process restart does NOT reset the timeout — staleness is a pure
    ///     function of (submittedAtUtc, nowUtc), both of which survive a
    ///     restart, so an in-flight order keeps aging toward Uncertain from
    ///     its original submission time rather than from reboot;
    ///   * the boundary is strict (&gt;), so an order exactly at the timeout is
    ///     not yet stale.
    /// </summary>
    public static class NativeStaleTimeout
    {
        public static bool IsStale(DateTime submittedAtUtc, DateTime nowUtc, int staleTimeoutMinutes)
        {
            int minutes = staleTimeoutMinutes < 0 ? 0 : staleTimeoutMinutes;
            return nowUtc - submittedAtUtc > TimeSpan.FromMinutes(minutes);
        }
    }
}
