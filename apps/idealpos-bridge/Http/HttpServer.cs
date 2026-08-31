using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using VerduraIdealposBridge.Config;
using VerduraIdealposBridge.Logging;
using VerduraIdealposBridge.Realtime;

namespace VerduraIdealposBridge.Http
{
    public class RouteParams
    {
        private readonly Dictionary<string, string> _values;
        public RouteParams(Dictionary<string, string> values) { _values = values; }
        public string Get(string name) => _values.TryGetValue(name, out var v) ? Uri.UnescapeDataString(v) : null;
    }

    public delegate void RouteHandler(HttpListenerContext ctx, RouteParams routeParams);

    /// <summary>
    /// Minimal HTTP host built directly on System.Net.HttpListener — no
    /// ASP.NET/OWIN/Kestrel. This is a small, fixed set of JSON endpoints
    /// plus one WebSocket upgrade; a hand-rolled router keeps the whole
    /// dependency list at zero and keeps every request's auth/CORS/error
    /// handling in one obvious place. Every route (including /api/health
    /// and the WebSocket upgrade) requires the bridge API key — see
    /// CheckAuth — because this process controls a restaurant's order
    /// pipeline and nothing about it should be reachable unauthenticated.
    /// </summary>
    public class HttpServer
    {
        private class Route
        {
            public string Method;
            public Regex Pattern;
            public RouteHandler Handler;
        }

        private readonly HttpListener _listener = new HttpListener();
        private readonly List<Route> _routes = new List<Route>();
        private readonly BridgeConfig _config;
        private readonly WebSocketHub _hub;
        private CancellationTokenSource _cts;
        private Regex _wsPattern;

        public HttpServer(BridgeConfig config, WebSocketHub hub)
        {
            _config = config;
            _hub = hub;
        }

        public void MapGet(string path, RouteHandler handler) => Map("GET", path, handler);
        public void MapPost(string path, RouteHandler handler) => Map("POST", path, handler);

        public void MapWebSocket(string path)
        {
            _wsPattern = ToRegex(path);
        }

        private void Map(string method, string path, RouteHandler handler)
        {
            _routes.Add(new Route { Method = method, Pattern = ToRegex(path), Handler = handler });
        }

        private static Regex ToRegex(string path)
        {
            string pattern = "^" + Regex.Replace(Regex.Escape(path), @"\\\{(\w+)\}", "(?<$1>[^/]+)") + "/?$";
            return new Regex(pattern, RegexOptions.IgnoreCase);
        }

        public void Start()
        {
            string prefix = "http://" + _config.BindAddress + ":" + _config.Port + "/";
            _listener.Prefixes.Add(prefix);
            _listener.Start();
            _cts = new CancellationTokenSource();
            Task.Run(() => AcceptLoop(_cts.Token));
            Logger.Info("http_listening", Logger.F("prefix", prefix), Logger.F("allowLan", _config.AllowLan));
        }

        public void Stop()
        {
            _cts?.Cancel();
            try { _listener.Stop(); } catch { }
        }

        private async Task AcceptLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested && _listener.IsListening)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = await _listener.GetContextAsync();
                }
                catch (Exception)
                {
                    if (token.IsCancellationRequested) break;
                    continue;
                }
                _ = Task.Run(() => HandleContextSafe(ctx, token));
            }
        }

        private async void HandleContextSafe(HttpListenerContext ctx, CancellationToken token)
        {
            string requestId = Guid.NewGuid().ToString("N").Substring(0, 8);
            try
            {
                await HandleContext(ctx, token, requestId);
            }
            catch (Exception ex)
            {
                Logger.Error("http_unhandled_exception", ex, Logger.F("requestId", requestId));
                try
                {
                    ResponseWriter.WriteJson(ctx, 500, new { error = "internal_error", requestId });
                }
                catch { /* response may already be closed */ }
            }
        }

        private async Task HandleContext(HttpListenerContext ctx, CancellationToken token, string requestId)
        {
            string path = ctx.Request.Url.AbsolutePath;
            string method = ctx.Request.HttpMethod.ToUpperInvariant();

            ApplyCors(ctx);
            if (method == "OPTIONS")
            {
                ctx.Response.StatusCode = 204;
                ctx.Response.Close();
                return;
            }

            // WebSocket upgrade
            if (_wsPattern != null && ctx.Request.IsWebSocketRequest && _wsPattern.IsMatch(path))
            {
                if (!CheckAuth(ctx, allowQueryStringToken: true))
                {
                    ResponseWriter.WriteJson(ctx, 401, new { error = "unauthorized" });
                    return;
                }
                HttpListenerWebSocketContext wsCtx = await ctx.AcceptWebSocketAsync(null);
                Logger.Info("http_request", Logger.F("requestId", requestId), Logger.F("method", "WS"), Logger.F("path", path), Logger.F("status", 101));
                await _hub.HandleClientAsync(wsCtx.WebSocket, token);
                return;
            }

            Route matched = null;
            RouteParams routeParams = null;
            bool pathMatchedAnyMethod = false;
            foreach (var route in _routes)
            {
                Match m = route.Pattern.Match(path);
                if (!m.Success) continue;
                pathMatchedAnyMethod = true;
                if (route.Method != method) continue;
                var values = new Dictionary<string, string>();
                foreach (string groupName in route.Pattern.GetGroupNames())
                {
                    if (int.TryParse(groupName, out _)) continue; // skip numeric auto-groups
                    values[groupName] = m.Groups[groupName].Value;
                }
                matched = route;
                routeParams = new RouteParams(values);
                break;
            }

            if (matched == null)
            {
                int status = pathMatchedAnyMethod ? 405 : 404;
                ResponseWriter.WriteJson(ctx, status, new { error = pathMatchedAnyMethod ? "method_not_allowed" : "not_found", path });
                Logger.Info("http_request", Logger.F("requestId", requestId), Logger.F("method", method), Logger.F("path", path), Logger.F("status", status));
                return;
            }

            if (!CheckAuth(ctx, allowQueryStringToken: false))
            {
                ResponseWriter.WriteJson(ctx, 401, new { error = "unauthorized", detail = "Missing or invalid Authorization: Bearer <key>." });
                Logger.Warn("http_request_unauthorized", Logger.F("requestId", requestId), Logger.F("path", path));
                return;
            }

            try
            {
                matched.Handler(ctx, routeParams);
            }
            finally
            {
                Logger.Info("http_request", Logger.F("requestId", requestId), Logger.F("method", method), Logger.F("path", path), Logger.F("status", ctx.Response.StatusCode));
            }
        }

        private bool CheckAuth(HttpListenerContext ctx, bool allowQueryStringToken)
        {
            string header = ctx.Request.Headers["Authorization"];
            if (!string.IsNullOrEmpty(header) && header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                string token = header.Substring("Bearer ".Length).Trim();
                if (SecureEquals(token, _config.ApiKey)) return true;
            }

            // Browsers cannot set custom headers on a WebSocket handshake,
            // so the WebSocket route alone also accepts ?api_key=... — a
            // documented, deliberate exception, not a general auth bypass.
            if (allowQueryStringToken)
            {
                string qsToken = ctx.Request.QueryString["api_key"];
                if (!string.IsNullOrEmpty(qsToken) && SecureEquals(qsToken, _config.ApiKey)) return true;
            }

            return false;
        }

        private static bool SecureEquals(string a, string b)
        {
            if (a == null || b == null) return false;
            if (a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }

        private void ApplyCors(HttpListenerContext ctx)
        {
            string origin = ctx.Request.Headers["Origin"];
            if (string.IsNullOrEmpty(origin) || _config.CorsAllowedOrigins.Length == 0) return;
            if (_config.CorsAllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase) || _config.CorsAllowedOrigins.Contains("*"))
            {
                ctx.Response.Headers["Access-Control-Allow-Origin"] = origin;
                ctx.Response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
                ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            }
        }
    }

    public static class ResponseWriter
    {
        public static void WriteJson(HttpListenerContext ctx, int statusCode, object body)
        {
            string json = JsonUtil.Serialize(body);
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            ctx.Response.StatusCode = statusCode;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.ContentLength64 = bytes.Length;
            try
            {
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            }
            finally
            {
                ctx.Response.OutputStream.Close();
            }
        }

        public static T ReadJsonBody<T>(HttpListenerContext ctx)
        {
            using (var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding ?? Encoding.UTF8))
            {
                string body = reader.ReadToEnd();
                return JsonUtil.Deserialize<T>(body);
            }
        }
    }
}
