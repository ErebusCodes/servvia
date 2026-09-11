/**
 * Derive the venue's site configuration from the 42 real Order2 captures.
 *
 * WHY A SCRIPT AND NOT A ONE-OFF. These 42 packets are the only authoritative
 * record of how the venue's own handheld actually talks to this till. Every
 * number in `site-config-evidence.json` is read out of them by this script, so
 * the evidence file can be regenerated and diffed rather than trusted. A value
 * that cannot be derived here is one nobody should be writing into a config.
 *
 * PROVENANCE. `.tmp-back-evidence/20260909-124209/derived/order2-vectors.json`,
 * extracted from `Ideal Handheld-*.LOG` on Front (DESKTOP-70DQTGJ) and copied
 * to Back read-only on 2026-09-09 under the SSH/SCP inventory recorded in that
 * directory's PROVENANCE.txt, with per-file SHA-256 verified source==copy.
 *
 * WHAT THIS SCRIPT WILL NOT DO. It does not average, guess, or pick a most
 * likely value. A field whose observations disagree is reported as CONTESTED
 * and carries every value seen, because a config value derived from a majority
 * vote across a restaurant's traffic is not a derivation.
 *
 * Usage:  node scripts/site-config/extract-order2-site-config.cjs [--write]
 */

const { readFileSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { join } = require("node:path");

const VECTORS = join(
  __dirname,
  "..",
  "..",
  ".tmp-back-evidence",
  "20260909-124209",
  "derived",
  "order2-vectors.json",
);
const OUT = join(__dirname, "site-config-evidence.json");

/** Packet-level fields: one value per packet. */
const PACKET_FIELDS = [
  "Map",
  "Location",
  "POSTerminal",
  "Clerk",
  "DeviceID",
  "PocketPad",
  "DeviceModel",
  "DeviceOS",
  "LocalAddress",
  "SkipKitchen",
  "KitchenOnly",
  "VoidMode",
  "PrintReceipt",
];

/** Line-level fields: one value per StockItem line. */
const LINE_FIELDS = ["PriceLevel", "Seat", "TaxString"];

function field(xml, name) {
  const m = new RegExp("<" + name + ">([^]*?)<" + "/" + name + ">").exec(xml);
  return m ? m[1].trim() : null;
}

function tally(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, observations]) => ({ value, observations }));
}

function main() {
  const raw = readFileSync(VECTORS);
  const sourceSha256 = createHash("sha256").update(raw).digest("hex");
  const vectors = JSON.parse(raw.toString("utf8"));

  const packet = {};
  for (const name of PACKET_FIELDS) {
    const seen = vectors
      .map((v) => field(v.body, name))
      .filter((x) => x !== null);
    const distinct = tally(seen);
    packet[name] = {
      packetsObserved: seen.length,
      distinct,
      unanimous: distinct.length === 1,
      value: distinct.length === 1 ? distinct[0].value : null,
      status:
        seen.length === 0
          ? "ABSENT"
          : distinct.length === 1
            ? "UNANIMOUS"
            : "CONTESTED",
    };
  }

  // One entry per distinct StockItem, with everything observed about it.
  const items = new Map();
  const lineValues = Object.fromEntries(LINE_FIELDS.map((f) => [f, []]));
  let lineCount = 0;

  for (const v of vectors) {
    const re = /<OrderItem[^>]*>([^]*?)<\/OrderItem>/g;
    let m;
    while ((m = re.exec(v.body))) {
      const blk = m[1];
      if (field(blk, "Type") !== "StockItem") continue;
      lineCount += 1;
      for (const f of LINE_FIELDS) {
        const val = field(blk, f);
        if (val !== null) lineValues[f].push(val);
      }
      const plu = field(blk, "StockItem");
      if (!items.has(plu)) {
        items.set(plu, {
          nativeCode: plu,
          descriptions: new Set(),
          prices: new Set(),
          lines: 0,
        });
      }
      const e = items.get(plu);
      e.descriptions.add(field(blk, "Description"));
      e.prices.add(field(blk, "Price"));
      e.lines += 1;
    }
  }

  const line = {};
  for (const f of LINE_FIELDS) {
    const distinct = tally(lineValues[f]);
    line[f] = {
      linesObserved: lineValues[f].length,
      distinct,
      unanimous: distinct.length === 1,
      value: distinct.length === 1 ? distinct[0].value : null,
      status:
        lineValues[f].length === 0
          ? "ABSENT"
          : distinct.length === 1
            ? "UNANIMOUS"
            : "CONTESTED",
    };
  }

  const stockItems = [...items.values()]
    .sort((a, b) => Number(a.nativeCode) - Number(b.nativeCode))
    .map((e) => ({
      nativeCode: e.nativeCode,
      // Descriptions arrive space-padded from the till and are kept trimmed but
      // otherwise verbatim, entities and all. They are EVIDENCE about the
      // venue's catalogue, never a key: nothing matches on a description.
      descriptions: [...e.descriptions],
      observedPrices: [...e.prices],
      // A PLU whose observed price is not single-valued cannot be used to
      // prove a price level, and is flagged rather than reduced to one price.
      priceStable: e.prices.size === 1,
      lines: e.lines,
    }));

  const report = {
    generatedBy: "scripts/site-config/extract-order2-site-config.cjs",
    source: {
      path: ".tmp-back-evidence/20260909-124209/derived/order2-vectors.json",
      sha256: sourceSha256,
      packets: vectors.length,
      stockItemLines: lineCount,
      distinctStockItems: stockItems.length,
      provenance:
        "Ideal Handheld-*.LOG on Front (DESKTOP-70DQTGJ), copied read-only to Back on " +
        "2026-09-09 with per-file SHA-256 verified source==copy. See " +
        ".tmp-back-evidence/20260909-124209/PROVENANCE.txt",
    },
    // EVERY VALUE BELOW DESCRIBES THE VENUE'S OWN iPAD. None of it is
    // automatically Verdura's: the DeviceID is the iPad's and must never be
    // reused, and POSTerminal is assigned at handheld registration, so
    // Verdura's is unknown until a legitimate seat exists.
    packetFields: packet,
    lineFields: line,
    stockItems,
  };

  const json = JSON.stringify(report, null, 2) + "\n";
  if (process.argv.includes("--write")) {
    writeFileSync(OUT, json);
    console.log("wrote", OUT);
  }

  console.log(
    `packets=${vectors.length} lines=${lineCount} distinctPLUs=${stockItems.length}`,
  );
  for (const [name, r] of Object.entries(packet)) {
    console.log(
      `  ${name.padEnd(13)} ${r.status.padEnd(9)} ${r.value ?? r.distinct.map((d) => d.value).join(" | ")}`,
    );
  }
  for (const [name, r] of Object.entries(line)) {
    console.log(
      `  ${name.padEnd(13)} ${r.status.padEnd(9)} ${r.value ?? r.distinct.map((d) => d.value).join(" | ")}  (line-level)`,
    );
  }
  const unstable = stockItems.filter((s) => !s.priceStable);
  console.log(`  PLUs with a non-constant observed price: ${unstable.length}`);
}

main();
