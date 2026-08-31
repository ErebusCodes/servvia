using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using VerduraIdealposBridge.Logging;

namespace VerduraIdealposBridge.Realtime
{
    /// <summary>
    /// GET /ws/orders (HttpListener's built-in AcceptWebSocketAsync — no
    /// SignalR, no external framework) upgrades here. Broadcast-only: every
    /// connected client receives every order.statusChanged event. Per-topic
    /// filtering (e.g. "only this table's tablet") is a reasonable future
    /// addition, out of scope for this first version — noted in README.
    /// </summary>
    public class WebSocketHub
    {
        private readonly ConcurrentDictionary<Guid, WebSocket> _clients = new ConcurrentDictionary<Guid, WebSocket>();

        public int ConnectedClientCount => _clients.Count;

        public async Task HandleClientAsync(WebSocket socket, CancellationToken cancellationToken)
        {
            Guid id = Guid.NewGuid();
            _clients[id] = socket;
            Logger.Info("ws_client_connected", Logger.F("clientId", id), Logger.F("totalClients", _clients.Count));

            var buffer = new byte[4096];
            try
            {
                while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
                {
                    WebSocketReceiveResult result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closing", cancellationToken);
                        break;
                    }
                    // This bridge is push-only to Verdura; any frame a
                    // client sends (beyond protocol-level ping/close) is
                    // simply discarded rather than acted on.
                }
            }
            catch (Exception ex)
            {
                Logger.Debug("ws_client_error", Logger.F("clientId", id), Logger.F("error", ex.Message));
            }
            finally
            {
                WebSocket removed;
                _clients.TryRemove(id, out removed);
                Logger.Info("ws_client_disconnected", Logger.F("clientId", id), Logger.F("totalClients", _clients.Count));
            }
        }

        public void Broadcast(string json)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            foreach (var kvp in _clients)
            {
                WebSocket socket = kvp.Value;
                if (socket.State != WebSocketState.Open) continue;
                // Fire-and-forget per client so one slow/dead connection
                // can't block delivery to everyone else.
                Task.Run(async () =>
                {
                    try
                    {
                        await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                    catch (Exception ex)
                    {
                        Logger.Debug("ws_send_failed", Logger.F("error", ex.Message));
                    }
                });
            }
        }
    }
}
