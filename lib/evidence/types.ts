export type ArtifactType =
  | "folder"
  | "raw_html"
  | "markdown"
  | "screenshot"
  | "diff"
  | "claim_ledger"
  | "signal_brief"
  | "verdict_json"
  | "csv_export"
  | "public_news"
  | "report";

export type RiskLabel =
  | "High"
  | "Medium"
  | "Low"
  | "Competitive Risk"
  | "AI Positioning"
  | "Packaging"
  | "Leadership"
  | "Hiring"
  | "Sales"
  | "Brand Risk"
  | "Security Risk";

export type EvidenceSource = "SignalVault" | "Apify" | "Mastra Agent" | "Box" | "System";

export interface ActivityEntry {
  timestamp: string;
  message: string;
}

export interface EvidenceArtifact {
  id: string;
  name: string;
  type: ArtifactType;
  source: EvidenceSource;
  modifiedAt: string;
  size?: string;
  labels: RiskLabel[];
  description?: string;
  boxPath?: string;
  digest?: string;
  company?: string;
  relatedArtifactIds?: string[];
  activity?: ActivityEntry[];
}
