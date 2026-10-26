import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertCatalogShape,
  catalogStats,
  escapeMarkdown,
  findShowMatches,
  normalizeSearchText,
  paginateRecords,
  recordPayload,
  renderReferenceDocs,
  searchRecords,
  sourceUrlFor,
} from "../lib/browse.mjs";
import { parseCliArgs, UsageError } from "../browse.mjs";

const browsePath = fileURLToPath(new URL("../browse.mjs", import.meta.url));

function fixtureCatalog() {
  return {
    schema_version: 1,
    metadata: {
      source_name: "datawxq",
      entry_url: "https://datawxq.com/",
      database_url: "https://datawxq.com/database",
      retrieved_at: "2026-10-26T00:00:00Z",
      source_assets: [{ url: "https://datawxq.com/a.png", sha256: "abc", bytes: 10 }],
      counts: { talents: 2, commanders: 1, related_cards: 4 },
    },
    talents: [
      {
        id: 42,
        gameType: "wanxiang",
        name: "雷霆天赋",
        type: "talent",
        typeName: "战斗",
        quality: 3,
        description: "逐行\n叠加后触发",
        cardGetDescription: "通过\n击败首领获得",
        visibleOnOfficialSite: true,
        keywords: ["雷霆"],
        labels: ["连锁"],
        talentStageDescription: "第二阶段",
        group: { id: 9, name: "天雷", description: "雷系天赋组" },
        previewCards: [{ id: 301, name: "引雷", description: "预览牌效果" }],
        sourceCards: [{ id: 302, name: "雷池", description: "来源牌效果" }],
        detail: { effect: { description: "二次触发" } },
      },
      {
        id: 42,
        gameType: "diamond",
        name: "雷霆天赋",
        type: "talent",
        typeName: "战斗",
        quality: 1,
        description: "钻石模式描述",
        cardGetDescription: "钻石获取条件",
        previewCards: [],
        sourceCards: [],
      },
    ],
    commanders: [
      {
        id: "commander-r1",
        lordId: 10,
        roleIndex: 1,
        name: "刘备",
        quote: "仁德流转",
        sections: [
          { type: "技能", level: 1, entries: [{ id: 1, name: "仁德", description: "分发手牌" }] },
          { type: "秘技", level: 1, entries: [{ id: 2, name: "龙魂秘技", description: "秘技\n连环杀触发" }] },
          { type: "专属", level: 1, entries: [{ id: 3, name: "双股剑", description: "专属效果" }] },
        ],
        relatedCards: [{ id: 401, name: "关羽援军", description: "关羽援军关联牌描述" }],
        assets: { portrait: "https://datawxq.com/lb.png" },
      },
    ],
    related_cards: [
      { id: 301, name: "引雷", description: "预览牌效果" },
      { id: 302, name: "雷池", description: "来源牌效果" },
      { id: 401, name: "关羽援军", description: "关羽援军关联牌描述" },
      { id: "related-9", name: "雷火符", description: "雷火符造成灼烧" },
    ],
  };
}

test("normalizes multiline and Chinese search text", () => {
  const catalog = fixtureCatalog();
  assert.equal(normalizeSearchText("逐行\n叠加"), "逐行 叠加");
  assert.deepEqual(
    searchRecords(catalog, "逐行\n叠加").map((entry) => entry.record.id),
    [42],
  );
  assert.equal(searchRecords(catalog, "关羽援军关联牌描述", { type: "commander" }).length, 1);
  assert.equal(searchRecords(catalog, "秘技\n连环杀", { type: "commander" }).length, 1);
  assert.equal(searchRecords(catalog, "雷火符造成灼烧", { type: "related" }).length, 1);
});

test("applies record type, mode, and quality filters together", () => {
  const catalog = fixtureCatalog();
  const bronze = searchRecords(catalog, "雷霆天赋", {
    type: "talent",
    mode: "diamond",
    quality: "bronze",
  });
  assert.equal(bronze.length, 1);
  assert.equal(bronze[0].mode, "diamond");
  assert.equal(bronze[0].quality, 1);
  assert.equal(searchRecords(catalog, "雷霆天赋", { mode: "wanxiang", quality: "silver" }).length, 0);
  assert.equal(searchRecords(catalog, "雷霆天赋", { type: "commander" }).length, 0);
});

test("show lookup exposes duplicate IDs across modes instead of choosing one", () => {
  const catalog = fixtureCatalog();
  assert.equal(findShowMatches(catalog, "42").length, 2);
  const selected = findShowMatches(catalog, "42", { mode: "wanxiang" });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].record.gameType, "wanxiang");
  assert.equal(findShowMatches(catalog, "雷霆天赋").length, 2);
  assert.equal(findShowMatches(catalog, "no such record").length, 0);
});

test("record payloads keep source records and catalog provenance with fixed source URLs", () => {
  const catalog = fixtureCatalog();
  const [entry] = searchRecords(catalog, "雷霆天赋", { mode: "wanxiang" });
  const payload = recordPayload(catalog, entry);
  const url = new URL(sourceUrlFor(entry));
  assert.equal(url.origin, "https://www.datawxq.com");
  assert.equal(url.pathname, "/database");
  assert.equal(url.searchParams.get("tab"), "talents");
  assert.equal(url.searchParams.get("gameType"), "wanxiang");
  assert.equal(url.searchParams.get("keyword"), "雷霆天赋");
  assert.equal(payload.record, entry.record);
  assert.equal(payload.provenance.retrieved_at, catalog.metadata.retrieved_at);
});

test("related source links use real database categories", () => {
  for (const [type, tab] of [
    ["hero", "heroes"], ["effect", "effects"], ["equipment", "equipments"],
    [1, "heroes"], [2, "effects"], [5, "equipments"], [6, "talents"],
    [undefined, "commanders"],
  ]) {
    const url = new URL(sourceUrlFor({ type: "related", record: { type, name: "关联规则" } }));
    assert.equal(url.searchParams.get("tab"), tab);
  }
});

test("catalog statistics count records and talent qualities", () => {
  assert.deepEqual(catalogStats(fixtureCatalog()), {
    total: 7,
    talents: 2,
    commanders: 1,
    related_cards: 4,
    by_mode: { wanxiang: 1, diamond: 1, unspecified: 5 },
    talent_quality: { gold: 1, silver: 0, bronze: 1, unspecified: 0 },
  });
});

test("rendering is deterministic regardless of top-level source record order", () => {
  const first = fixtureCatalog();
  const second = fixtureCatalog();
  second.talents.reverse();
  second.commanders.reverse();
  second.related_cards.reverse();
  assert.deepEqual(renderReferenceDocs(first), renderReferenceDocs(second));
  first.talents.push({ ...first.talents[0], description: "同模式重复记录 B" });
  second.talents.push({
    ...second.talents.find((talent) => talent.gameType === "wanxiang"),
    description: "同模式重复记录 B",
  });
  second.talents.reverse();
  assert.deepEqual(renderReferenceDocs(first), renderReferenceDocs(second));

  const docs = renderReferenceDocs(first);
  assert.match(docs["TALENTS.md"], /Acquisition Requirements/);
  assert.match(docs["TALENTS.md"], /Quality/);
  assert.match(docs["TALENTS.md"], /击败首领获得/);
  assert.match(docs["TALENTS.md"], /引雷/);
  assert.match(docs["TALENTS.md"], /雷池/);
  assert.match(docs["TALENTS.md"], /RELATED_CARDS\.md#related-unspecified-301/);
  assert.match(docs["TALENTS.md"], /RELATED_CARDS\.md#related-unspecified-302/);
  assert.match(docs["COMMANDERS.md"], /Source: 技能/);
  assert.match(docs["COMMANDERS.md"], /Source: 秘技/);
  assert.match(docs["COMMANDERS.md"], /Source: 专属/);
  assert.match(docs["COMMANDERS.md"], /龙魂秘技/);
  assert.match(docs["COMMANDERS.md"], /关羽援军关联牌描述/);
  assert.match(docs["COMMANDERS.md"], /RELATED_CARDS\.md#related-unspecified-401/);
  assert.match(docs["RELATED_CARDS.md"], /雷火符造成灼烧/);
  assert.match(docs["TALENTS.md"], /talent-wanxiang-42/);
  assert.match(docs["TALENTS.md"], /talent-diamond-42/);
});

test("source Markdown and terminal controls are escaped", () => {
  const catalog = fixtureCatalog();
  catalog.talents[0].description = [
    '<script>alert("x")</script>',
    "![remote](https://evil.example/a.png)",
    "[click](javascript:alert(1))",
    "\u001b[31mterminal\u001b[0m",
  ].join("\n");
  const talentPage = renderReferenceDocs(catalog)["TALENTS.md"];
  assert.ok(!talentPage.includes("<script>"));
  assert.ok(!talentPage.includes("![remote]("));
  assert.ok(!talentPage.includes("[click]("));
  assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(talentPage));
  assert.ok(talentPage.includes("&lt;script&gt;"));
  assert.ok(talentPage.includes("\\!\\[remote\\]"));
  assert.ok(talentPage.includes("\\[click\\]"));
  assert.ok(escapeMarkdown("### <b>safe</b>").includes("\\#\\#\\# &lt;b&gt;"));
});

test("generated pages omit trailing whitespace without changing source values", () => {
  const catalog = fixtureCatalog();
  catalog.metadata.source_name = "datawxq  ";
  catalog.talents[0].videoId = "";
  catalog.talents[0].description = "first  \n \t\nlast\t";
  catalog.commanders[0].quote = "";
  catalog.related_cards[0].description = "\n\n";
  const original = structuredClone(catalog);

  for (const [name, markdown] of Object.entries(renderReferenceDocs(catalog))) {
    assert.doesNotMatch(markdown, /[ \t]+$/m, name);
    assert.ok(markdown.endsWith("\n"), name);
  }
  assert.deepEqual(catalog, original);
});

test("catalog requires schema version and all record collections", () => {
  const catalog = fixtureCatalog();
  assert.equal(assertCatalogShape(catalog), catalog);
  assert.throws(() => assertCatalogShape({ ...catalog, schema_version: undefined }), /schema_version/);
  assert.throws(() => assertCatalogShape({ ...catalog, commanders: undefined }), /commanders/);
  assert.throws(() => assertCatalogShape(null), /JSON object/);
});

test("search pagination reports explicit totals and an omitted-results flag", () => {
  const records = Array.from({ length: 23 }, (_, id) => ({ id }));
  assert.deepEqual(paginateRecords(records), {
    total: 23,
    shown: 20,
    has_more: true,
    results: records.slice(0, 20),
  });
  assert.deepEqual(paginateRecords(records, 30), {
    total: 23,
    shown: 23,
    has_more: false,
    results: records,
  });
  assert.throws(() => paginateRecords(records, 0), /positive integer/);
});

test("CLI parser rejects invalid commands, options, flags, and limits", () => {
  assert.throws(() => parseCliArgs([]), UsageError);
  assert.throws(() => parseCliArgs(["wat"]), /Unknown command/);
  assert.throws(() => parseCliArgs(["search", "雷", "--type", "hero"]), /Invalid type/);
  assert.throws(() => parseCliArgs(["search", "雷", "--mode", "old"]), /Invalid mode/);
  assert.throws(() => parseCliArgs(["search", "雷", "--quality", "mythic"]), /Invalid quality/);
  assert.throws(() => parseCliArgs(["search", "雷", "--limit", "0"]), /positive integer/);
  assert.throws(() => parseCliArgs(["search", "雷", "--nope"]), /Unknown option/);
  assert.throws(() => parseCliArgs(["show", "雷", "--limit", "2"]), /not valid for show/);
  assert.throws(() => parseCliArgs(["stats", "extra"]), /does not accept positional/);
});

test("CLI parse joins unquoted query words and keeps search pagination finite", () => {
  assert.deepEqual(parseCliArgs(["search", "雷霆", "天赋", "--mode", "wanxiang", "--limit", "5"]), {
    command: "search",
    target: "雷霆 天赋",
    options: { mode: "wanxiang", limit: 5 },
    filters: { mode: "wanxiang" },
  });
  assert.deepEqual(parseCliArgs(["show", "雷霆", "天赋", "--type", "talent"]).target, "雷霆 天赋");
});

test("unknown CLI commands fail before trying to open the catalog", () => {
  const result = spawnSync(process.execPath, [browsePath, "unknown-command"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command/);
  assert.match(result.stderr, /Usage:/);
});
