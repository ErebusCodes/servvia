using System;
using System.Collections.Generic;
using System.Linq;

namespace VerduraIdealposBridge.Orders
{
    public class ValidationResult
    {
        public bool IsValid => Errors.Count == 0;
        public List<string> Errors { get; } = new List<string>();
        public bool IsDuplicate { get; set; }
        public void Fail(string message) => Errors.Add(message);
    }

    /// <summary>
    /// Pure logic, deliberately free of SQL/SQLite/HTTP so it can be
    /// exercised by Tests/ without Windows or Idealpos present — see
    /// Tests/OrderValidatorTests.cs. Takes already-fetched data
    /// (validTables/validProductCodes) plus a duplicate-check delegate
    /// rather than reaching out to any store itself.
    /// </summary>
    public class OrderValidator
    {
        public ValidationResult Validate(
            OrderRequest request,
            ISet<string> validTables,
            ISet<string> validProductCodes,
            Func<string, bool> externalOrderIdAlreadyExists)
        {
            var result = new ValidationResult();

            if (request == null)
            {
                result.Fail("Request body is missing or not valid JSON.");
                return result;
            }

            if (string.IsNullOrWhiteSpace(request.ExternalOrderId))
            {
                result.Fail("externalOrderId is required.");
            }
            else if (request.ExternalOrderId.Length > 200)
            {
                result.Fail("externalOrderId is too long (max 200 characters).");
            }

            if (string.IsNullOrWhiteSpace(request.Table))
            {
                result.Fail("table is required.");
            }
            else if (validTables != null && !validTables.Contains(request.Table.Trim()))
            {
                result.Fail("table \"" + request.Table + "\" does not exist in Idealpos's current table map.");
            }

            if (request.Items == null || request.Items.Count == 0)
            {
                result.Fail("items must contain at least one line.");
            }
            else
            {
                for (int i = 0; i < request.Items.Count; i++)
                {
                    var line = request.Items[i];
                    string prefix = "items[" + i + "]: ";
                    if (line == null)
                    {
                        result.Fail(prefix + "line is null.");
                        continue;
                    }
                    if (string.IsNullOrWhiteSpace(line.ProductCode))
                    {
                        result.Fail(prefix + "productCode is required.");
                    }
                    else if (validProductCodes != null && !validProductCodes.Contains(line.ProductCode.Trim()))
                    {
                        result.Fail(prefix + "productCode \"" + line.ProductCode + "\" does not exist in Idealpos's current product list.");
                    }

                    if (line.Quantity <= 0)
                    {
                        result.Fail(prefix + "quantity must be greater than zero.");
                    }
                    else if (line.Quantity > 999)
                    {
                        result.Fail(prefix + "quantity is implausibly large (max 999) — refused as a likely input error.");
                    }
                }

                var dupCodes = request.Items
                    .Where(l => l != null && !string.IsNullOrWhiteSpace(l.ProductCode))
                    .GroupBy(l => l.ProductCode.Trim(), StringComparer.OrdinalIgnoreCase)
                    .Where(g => g.Count() > 1)
                    .Select(g => g.Key)
                    .ToList();
                if (dupCodes.Count > 0)
                {
                    result.Fail("duplicate productCode(s) within one order: " + string.Join(", ", dupCodes) +
                                " — combine into a single line with the total quantity instead.");
                }
            }

            // Idempotency is enforced primarily by OrderService (which
            // short-circuits before re-validating or re-submitting at all),
            // but a duplicate found here still gets a clear message rather
            // than a generic validation failure if callers reach this path
            // directly (e.g. from tests).
            if (!string.IsNullOrWhiteSpace(request.ExternalOrderId) &&
                externalOrderIdAlreadyExists != null &&
                externalOrderIdAlreadyExists(request.ExternalOrderId))
            {
                // Not added to Errors: OrderService treats this as "return
                // existing state", not a validation failure. Exposed via
                // ValidationResult so callers/tests can still detect it if
                // they call OrderValidator directly.
                result.IsDuplicate = true;
            }

            return result;
        }
    }
}
