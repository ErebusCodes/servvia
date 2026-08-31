using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace VerduraIdealposBridge.Http
{
    /// <summary>Thin wrapper over Idealpos's own bundled Newtonsoft.Json.dll
    /// (see lib/PUT_DLLS_HERE.txt) — camelCase on the wire to match every
    /// example in the request (externalOrderId, productCode, etc.).</summary>
    public static class JsonUtil
    {
        private static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
            NullValueHandling = NullValueHandling.Include,
            DateFormatHandling = DateFormatHandling.IsoDateFormat,
        };

        public static string Serialize(object value) => JsonConvert.SerializeObject(value, Settings);

        public static T Deserialize<T>(string json) => JsonConvert.DeserializeObject<T>(json, Settings);
    }
}
