using System;
using System.Collections.Generic;
using System.Linq;

namespace VerduraIdealposBridge.TableAssignment
{
    public static class TableAssignmentStrategyFactory
    {
        private static readonly Dictionary<string, Func<ITableAssignmentStrategy>> Registry =
            new Dictionary<string, Func<ITableAssignmentStrategy>>(StringComparer.OrdinalIgnoreCase)
        {
            { "NoHint", () => new NoHintStrategy() },
            { "DeliverTo", () => new DeliverToStrategy() },
            { "Message", () => new MessageStrategy() },
            { "ReferencePrefix", () => new ReferencePrefixStrategy() },
            { "HostReference", () => new HostReferenceStrategy() },
        };

        public static IEnumerable<string> KnownStrategyNames => Registry.Keys;

        /// <summary>Throws with a clear message listing valid options if the
        /// configured name is unrecognized — the bridge should fail to
        /// start rather than silently pick something. See BridgeConfig,
        /// which already refuses to start on a blank value; this handles
        /// the "set but misspelled" case.</summary>
        public static ITableAssignmentStrategy Create(string name)
        {
            Func<ITableAssignmentStrategy> factory;
            if (!Registry.TryGetValue(name, out factory))
            {
                throw new ArgumentException(
                    "Unrecognized Idealpos:TableAssignmentStrategy \"" + name + "\". Valid values: " +
                    string.Join(", ", Registry.Keys.OrderBy(k => k)) + ".");
            }
            return factory();
        }
    }
}
