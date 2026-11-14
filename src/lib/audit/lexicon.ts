import { foldText } from "@/lib/text-fold";
import { splitSentences } from "./text";
import type { ContentType, FindingCategory, MatchedSignal } from "./types";

/**
 * Deterministic risk-signal lexicon. A hit only means "look up evidence for this";
 * it is never shown as a finding on its own unless the model is unavailable (rules_only mode).
 * Triggers run against diacritic-folded lowercase text, so Latin parts are written without accents.
 */
export interface SignalGroup {
  id: string;
  label: string;
  category: FindingCategory;
  trigger?: RegExp;
  /** Group only counts when one of these groups also matched. */
  requires?: string[];
  contentTypes?: ContentType[];
  /** Search terms looked up in evidence_records. */
  keywords: string[];
  /** Too generic to be a finding on its own in rules_only mode; still used for retrieval. */
  contextOnly?: boolean;
  /** Neutral human-review prompt used in rules_only mode. */
  reviewHint: string;
}

const MAP_HINT = "核对地图中的边界、海域和地名标注是否符合目标市场要求；无法确认时考虑移除地图或改用不含海域和边界的城市列表，并请当地团队人工复核。";

export const SIGNAL_GROUPS: SignalGroup[] = [
  {
    id: "map",
    label: "地图与底图",
    category: "geopolitical",
    trigger: /地图|底图|分布图|ban do|\bmaps?\b/,
    keywords: ["地图", "底图", "map", "bản đồ", "地名"],
    contextOnly: true,
    reviewHint: MAP_HINT,
  },
  {
    id: "disputed_names",
    label: "争议海域与岛礁名称",
    category: "geopolitical",
    trigger: /西沙|南沙|xisha|nansha|paracel|spratly|hoang sa|truong sa|黄沙群岛|长沙群岛|南海诸岛|九段线|十段线|南海|东海|duong chin doan|duong luoi bo|nine[- ]dash/,
    keywords: ["Xisha", "Nansha", "Hoang Sa", "Truong Sa", "黄沙", "长沙", "九段线", "nine-dash", "đường chín đoạn", "Paracel", "Spratly", "主权"],
    reviewHint: "该表述涉及争议海域或岛礁名称，属于潜在高风险内容，发布前必须由当地法律或市场团队人工复核。",
  },
  {
    id: "sovereignty",
    label: "国界与领土表述",
    category: "geopolitical",
    trigger: /国界|边界|边境线|领土|领海|主权|海域|岛屿|群岛|lanh tho|chu quyen/,
    keywords: ["国界", "领土", "主权", "边界"],
    reviewHint: MAP_HINT,
  },
  {
    id: "embedded_app",
    label: "App 与链接中的地图",
    category: "geopolitical",
    trigger: /\bapp\b|应用程序|小程序|扫码下载|下载链接|ung dung/,
    requires: ["map", "disputed_names"],
    keywords: ["App", "应用", "链接"],
    reviewHint: "App、小程序和社媒链接指向的页面同样会被审视，需要把其中内嵌的地图一并纳入发布前复核。",
  },
  {
    id: "national_symbols",
    label: "国家象征与人物形象",
    category: "cultural",
    // "胡志明市" / "Ho Chi Minh City" is a place name, not the person.
    trigger: /国旗|国徽|国歌|党旗|红旗金星|金星红旗|胡志明(?!市)|领导人|民族英雄|quoc ky|quoc huy|quoc ca|co do sao vang|ho chi minh(?!\s*city)/,
    keywords: ["国旗", "国徽", "国歌", "党旗", "民族英雄", "领导人"],
    reviewHint: "国家象征、领导人与民族英雄形象在广告中的使用受到限制，发布前需人工复核用法。",
  },
  {
    id: "religion",
    label: "宗教与信仰",
    category: "cultural",
    trigger: /宗教|信仰|佛教|佛祖|佛像|寺庙|教堂|基督|伊斯兰|清真|斋月|ton giao/,
    keywords: ["宗教", "信仰"],
    reviewHint: "涉及宗教与信仰的表达需人工复核，避免可能被理解为冒犯或不尊重的用法。",
  },
  {
    id: "ethnicity",
    label: "民族与种族",
    category: "cultural",
    trigger: /民族|京族|少数民族|种族|肤色|dan toc/,
    keywords: ["民族", "种族"],
    reviewHint: "涉及民族与种族的表达需人工复核，避免歧视或刻板印象。",
  },
  {
    id: "gender",
    label: "性别刻板印象",
    category: "cultural",
    trigger: /女人就该|女人就是|男人就该|男人就是|女性就该|男性就该|主妇|贤妻|娘炮|女司机|性别/,
    keywords: ["性别"],
    reviewHint: "检查是否包含性别歧视或刻板印象的表达，必要时改写。",
  },
  {
    id: "superlative",
    label: "绝对化用语",
    category: "language",
    trigger: /最好|最佳|最强|最低价|最高|最受欢迎|第一|no\.?\s?1|number one|\bbest\b|\bonly\b|唯一|顶级|冠军|tot nhat|so 1|duy nhat|hang dau/,
    keywords: ["最高级", "绝对化", "best", "number one"],
    reviewHint: "去掉绝对化表述，改为可以用证明文件支撑的具体参数或事实；如需保留，应准备相应的合法证明文件。",
  },
  {
    id: "comparison",
    label: "与竞品直接比较",
    category: "product",
    trigger: /比.{0,12}(好|强|高|快|优|更|多)|优于|胜过|吊打|碾压|\d+(\.\d+)?\s*倍|better than|hon han/,
    keywords: ["直接比较", "比较"],
    reviewHint: "避免点名或可识别地与同类竞品比较价格、质量或效果，改为陈述自身可验证的参数。",
  },
  {
    id: "medical",
    label: "医疗化宣称与医务人员背书",
    category: "product",
    trigger: /医生|皮肤科|医院|药师|医师|专家推荐|白大褂|治疗|根治|治愈|疗效|药效|处方|bac si|dieu tri|chua khoi/,
    keywords: ["医生", "药师", "药品", "医疗", "医务人员", "疗效"],
    reviewHint: "删除医生、药师、医疗机构等背书和治疗类表述，功效描述与依法公布的内容保持一致。",
  },
  {
    id: "efficacy",
    label: "功效与效果承诺",
    category: "product",
    trigger: /淡斑|祛斑|美白|抗皱|去皱|减肥|瘦身|增高|生发|见效|立竿见影|保证有效|100%|whitening|trang da|giam can/,
    keywords: ["功效", "化妆品", "误导", "虚假", "不准确"],
    reviewHint: "功效和时间类承诺需要有检测报告或依法公布的功效作为依据；无法提供时改为保守表述。",
  },
  {
    id: "food_health",
    label: "食品与保健宣称",
    category: "product",
    trigger: /保健|营养品|代餐|替代正餐|等于一|膳食补充|补充剂|功能性食品|thuc pham/,
    keywords: ["食品", "保健食品", "等于"],
    reviewHint: "食品和保健食品广告有专门的标注要求，宣称需与检测报告和自我公布档案一致。",
  },
  {
    id: "free_shipping",
    label: "促销与包邮承诺",
    category: "platform",
    trigger: /包邮|免运费|免邮|全场|所有订单|任何订单|无条件|freeship|free ship|mien phi van chuyen/,
    keywords: ["包邮", "免运", "促销", "误导"],
    reviewHint: "全称式促销承诺需要和例外条件放在同一屏，并在网页、App、站内信等各端保持一致。",
  },
  {
    id: "livestream",
    label: "直播与达人带货",
    category: "platform",
    trigger: /直播|主播|带货|livestream|live stream|\bkol\b|网红|达人/,
    keywords: ["直播", "主播"],
    reviewHint: "直播口播同样适用广告规则，建议事前审核直播脚本并留存记录。",
  },
  {
    id: "ecommerce",
    label: "电商平台经营",
    category: "platform",
    trigger: /入驻|开店|店铺|跨境电商|电商平台|shopee|lazada|tiktok shop|temu|tiki/,
    keywords: ["电子商务", "电商"],
    contextOnly: true,
    reviewHint: "核对平台和当地电子商务规则对卖家身份与信息披露的要求。",
  },
  {
    id: "aftersale",
    label: "售后与退换承诺",
    category: "aftersale",
    trigger: /退款|退货|退换|补发|保修|质保|售后|赔偿|hoan tien|doi tra|bao hanh/,
    // Looks for after-sales policy evidence only; "保修期" in the misleading-advertising rule is about false claims, not policy.
    keywords: ["售后", "退货", "退换"],
    reviewHint: "售后时限与承诺需对照平台规则和当地消费者保护规定核实。",
  },
  {
    id: "ad_language",
    label: "广告语言与版式",
    category: "language",
    contentTypes: ["advertisement"],
    keywords: ["越南语", "外语", "字号"],
    reviewHint: "广告正文需以越南语为主；双语时外文字号不超过越南语的 3/4 且置于越南语下方。字号比例需对照设计稿人工确认。",
  },
];

const VIETNAMESE_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/giu;

/** True when an advertisement is mostly not in Vietnamese (the ad-language rule needs a human check). */
function lacksVietnamese(text: string): boolean {
  const letters = text.match(/[\p{L}]/gu)?.length ?? 0;
  const vn = text.match(VIETNAMESE_CHARS)?.length ?? 0;
  return letters > 0 && vn / letters < 0.05;
}

export interface SignalExtraction {
  signals: MatchedSignal[];
  groups: SignalGroup[];
  keywords: string[];
  boostCategories: string[];
}

export function extractSignals(text: string, contentType: ContentType): SignalExtraction {
  const sentences = splitSentences(text);
  const hits = new Map<string, MatchedSignal[]>();

  for (const g of SIGNAL_GROUPS) {
    if (g.contentTypes && !g.contentTypes.includes(contentType)) continue;
    if (!g.trigger) continue;
    for (const s of sentences) {
      const m = foldText(s.text).match(g.trigger);
      if (!m) continue;
      const list = hits.get(g.id) ?? [];
      list.push({ id: g.id, label: g.label, category: g.category, term: m[0], sentence: s.text });
      hits.set(g.id, list);
    }
  }

  const adLanguage = SIGNAL_GROUPS.find((g) => g.id === "ad_language")!;
  if (contentType === "advertisement" && lacksVietnamese(text) && sentences.length > 0) {
    const latin = sentences.find((s) => /[a-z]{3,}/i.test(s.text)) ?? sentences[0];
    hits.set(adLanguage.id, [
      { id: adLanguage.id, label: adLanguage.label, category: adLanguage.category, term: "越南语占比低", sentence: latin.text },
    ]);
  }

  const active = SIGNAL_GROUPS.filter((g) => hits.has(g.id) && (!g.requires || g.requires.some((r) => hits.has(r))));
  return {
    signals: active.flatMap((g) => hits.get(g.id)!),
    groups: active,
    keywords: [...new Set(active.flatMap((g) => g.keywords))],
    boostCategories: [...new Set(active.map((g) => g.category))],
  };
}
