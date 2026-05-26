export type StoredExample = {
  id: string;
  copywriter_id: string;
  name: string;
  kind: "text" | "image";
  text: string;
  dataUrl: string;
  created_at: string;
};

export type StyleProfile = {
  summary?: string;
  training_status?: {
    ready: boolean;
    score: number;
    example_count: number;
    text_chars: number;
    required_examples: number;
    required_text_chars: number;
    recommended_short_posts: number;
    used_examples: number;
    capped: boolean;
    guidance: string[];
  };
  voice?: string[];
  structure?: string[];
  rhythm?: string[];
  hooks?: string[];
  vocabulary?: string[];
  punctuation?: string[];
  audience?: string;
  do?: string[];
  avoid?: string[];
  learned_corrections?: string[];
  prompt_addon?: string;
  trained_at?: string;
  source_count?: number;
  [key: string]: unknown;
};

export type LessonAnalysis = {
  mistakes?: string[];
  missing_style_moves?: string[];
  overused_patterns?: string[];
  rules_to_add?: string[];
  prompt_patch?: string;
  summary?: string;
  [key: string]: unknown;
};

export type StoredLesson = {
  id: string;
  copywriter_id: string;
  ai_text: string;
  ideal_text: string;
  analysis: LessonAnalysis;
  created_at: string;
};

export type StoredRecommendation = {
  id: string;
  copywriter_id: string;
  name: string;
  kind: "text" | "image";
  text: string;
  dataUrl: string;
  created_at: string;
};

export type Copywriter = {
  id: string;
  owner_account_id?: string;
  name: string;
  notes: string;
  profile: StyleProfile;
  has_profile: boolean;
  example_count: number;
  lesson_count: number;
  recommendation_count: number;
  created_at: string;
  updated_at: string;
  examples?: StoredExample[];
  lessons?: StoredLesson[];
  recommendations?: StoredRecommendation[];
};

export type Account = {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
};

export type SyncEvent = {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  created_at: string;
};

export type IncomingFile = {
  name?: string;
  kind?: string;
  text?: string;
  dataUrl?: string;
};
