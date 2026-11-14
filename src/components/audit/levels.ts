import type { FindingCategory, Level } from "@/lib/audit/types";

export const LEVEL_UI: Record<Level, { label: string; explain: string; color: string; text: string; soft: string; rule: string }> = {
  high: {
    label: "潜在高风险",
    explain: "内容中有与已核验事件相同机制的要素。这不是法律结论，发布前必须人工复核。",
    color: "#bf2a1e",
    text: "text-cinnabar",
    soft: "bg-cinnabar-soft",
    rule: "border-cinnabar",
  },
  medium: {
    label: "中风险",
    explain: "表述与已核验的规则或风险信号相关，是否构成问题取决于内容之外的事实，例如是否持有证明文件。",
    color: "#9a5b0c",
    text: "text-ochre",
    soft: "bg-ochre-soft",
    rule: "border-ochre",
  },
  needs_review: {
    label: "待人工复核",
    explain: "仅凭文本无法判断，需要人工对照证据确认。",
    color: "#4b43a8",
    text: "text-review",
    soft: "bg-review-soft",
    rule: "border-review",
  },
  low: {
    label: "低风险",
    explain: "没有发现能由已核验证据支持的风险。这不等于内容一定没有问题。",
    color: "#3f6b57",
    text: "text-sage",
    soft: "bg-sage-soft",
    rule: "border-sage",
  },
};

export const LEVEL_RANK: Record<Level, number> = { low: 0, needs_review: 1, medium: 2, high: 3 };

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  geopolitical: "地缘政治",
  cultural: "文化",
  language: "语言",
  platform: "平台",
  product: "产品表达",
  aftersale: "售后",
};

export const NO_EVIDENCE_NOTICE = "未找到可核验依据，不建议据此作出发布决定。";
