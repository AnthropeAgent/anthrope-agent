import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { security } from "../src/index";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const DEGEN = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

test("GoPlus EVM (Base): holders persen, label LP, skor dan pemeriksaan", () => {
  const raw = fixture("goplus-base-degen.json").result[DEGEN];
  const { report, holders } = security.fromGoplusEvm("base", DEGEN, raw, 0.002);
  assert.equal(holders.items[0].rank, 1);
  assert.ok(Math.abs(holders.items[0].pct - 24.1628) < 0.001); // fraksi 0.2416 → 24.16%
  assert.ok(holders.items.every((h, i, a) => i === 0 || a[i - 1].pct >= h.pct));
  assert.ok(holders.items[0].valueUsd > 0);
  assert.equal(holders.holderCount, 1182913);
  assert.equal(report.summary.honeypot, false);
  assert.equal(report.summary.buyTax, 0);
  assert.equal(report.summary.mintRevoked, false); // is_mintable = 1
  assert.ok(report.flags.includes("mintable"));
  assert.ok(report.score! > 40 && report.score! < 100);
  assert.equal(report.owner, "0x704ec5c12ca20a293c2c0b72b22619a4231f3c0d");
  assert.ok(report.checks.find((c) => c.key === "proxy")?.status === "ok");
});

test("GoPlus Solana: authority dicabut, top10 tanpa LP, Token-2022 bersih", () => {
  const raw = fixture("goplus-solana-bonk.json").result[BONK];
  const { report, holders } = security.fromGoplusSolana(BONK, raw, 0.00002);
  assert.equal(report.summary.mintRevoked, true);
  assert.equal(report.summary.freezeRevoked, true);
  assert.equal(report.checks.find((c) => c.key === "transfer_hook")?.status, "ok");
  assert.equal(report.checks.find((c) => c.key === "metadata_mutable")?.status, "warn");
  assert.ok(holders.top10Pct! > 0 && holders.top10Pct! < 100);
  assert.equal(report.risk, "low");
});

test("Skor: honeypot = 0, tidak ada data = null", () => {
  const hp = security.scoreFacts("base", { ...security.NO_FACTS, honeypot: true, buyTax: 0, sellTax: 0 });
  assert.equal(hp.score, 0);
  assert.equal(hp.risk, "high");
  const none = security.scoreFacts("solana", security.NO_FACTS);
  assert.equal(none.score, null);
  assert.equal(none.risk, "unknown");
  assert.ok(none.checks.every((c) => c.status === "unknown"));
  const rug = security.scoreFacts("solana", { ...security.NO_FACTS, mintable: true, freezable: true, top10Pct: 80 });
  assert.equal(rug.risk, "high");
});

test("Holders: alamat tidak valid dan persen aneh dibuang, label disanitasi, burn/LP tidak dihitung di top10", () => {
  const snap = security.finishHolders(
    "base",
    [
      { address: "0x000000000000000000000000000000000000dead", amount: 500, pct: 50 },
      { address: "0x1111111111111111111111111111111111111111", amount: 100, pct: 10, tag: "<script>x</script>" },
      { address: "0x2222222222222222222222222222222222222222", amount: 50, pct: 5 },
      { address: "0x3333333333333333333333333333333333333333", amount: 1, pct: 500 },
    ],
    1,
    new Set(["0x2222222222222222222222222222222222222222"]),
    3,
    "test",
  );
  assert.equal(snap.items.length, 3);
  assert.equal(snap.items[0].label, "Burn");
  assert.equal(snap.items[1].label, "scriptx/script");
  assert.equal(snap.items[2].label, "LP");
  assert.equal(snap.top10Pct, 10);
});

test("Solana mint (RPC): ekstensi Token-2022 berbahaya terdeteksi", () => {
  const f = security.factsFromMint({
    mintAuthority: null,
    freezeAuthority: "F1",
    supply: "1000",
    decimals: 0,
    extensions: [{ extension: "permanentDelegate" }, { extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: 250 } } }],
  });
  assert.equal(f.mintable, false);
  assert.equal(f.freezable, true);
  assert.equal(f.permanentDelegate, true);
  assert.equal(f.transferFeePct, 2.5);
  const s = security.scoreFacts("solana", { ...security.NO_FACTS, ...f });
  assert.ok(s.flags.includes("permanent_delegate") && s.flags.includes("freeze_authority") && s.flags.includes("transfer_fee"));
});
