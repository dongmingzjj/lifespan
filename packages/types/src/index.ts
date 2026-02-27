// 共享类型定义

// 事件类型
export enum EventType {
  APP_USAGE = 'app_usage',
  WEB_ACTIVITY = 'web_activity',
  FILE_ACTIVITY = 'file_activity',
  COMMUNICATION = 'communication',
}

// 应用分类
export enum AppCategory {
  WORK = 'work',
  COMMUNICATION = 'communication',
  ENTERTAINMENT = 'entertainment',
  LEARNING = 'learning',
  UTILITY = 'utility',
  OTHER = 'other',
}

// 基础事件接口
export interface BaseEvent {
  id: string;
  type: EventType;
  timestamp: number;
  deviceId: string;
}

// 应用使用事件
export interface AppUsageEvent extends BaseEvent {
  type: EventType.APP_USAGE;
  appName: string;
  windowTitle: string;
  duration: number;
  category: AppCategory;
}

// 网页活动事件
export interface WebActivityEvent extends BaseEvent {
  type: EventType.WEB_ACTIVITY;
  url: string;
  title: string;
  duration: number;
}

// 文件活动事件
export interface FileActivityEvent extends BaseEvent {
  type: EventType.FILE_ACTIVITY;
  filePath: string;
  action: 'open' | 'edit' | 'create' | 'delete';
}

// 通信事件
export interface CommunicationEvent extends BaseEvent {
  type: EventType.COMMUNICATION;
  platform: 'wechat' | 'email' | 'slack' | 'telegram';
  direction: 'sent' | 'received';
}

// 时间线
export interface Timeline {
  id: string;
  date: Date;
  segments: TimeSegment[];
  statistics: TimelineStatistics;
}

export interface TimeSegment {
  startTime: number;
  endTime: number;
  activity: string;
  category: string;
  metadata: Record<string, any>;
}

export interface TimelineStatistics {
  totalWorkHours: number;
  totalFocusHours: number;
  contextSwitches: number;
  mostUsedApps: AppUsage[];
  productivityScore: number;
}

export interface AppUsage {
  name: string;
  duration: number;
  category: AppCategory;
}

// 用户画像
export interface UserPortrait {
  profile: UserProfile;
  patterns: UserPatterns;
  interests: UserInterests;
  habits: UserHabits;
  relationships: UserRelationships;
  goals: UserGoals;
}

export interface UserProfile {
  workHours: { start: string; end: string };
  peakProductivityTime: string[];
  deepWorkCapacity: number;
}

export interface UserPatterns {
  distractionTriggers: string[];
  focusEnablers: string[];
  contextSwitchCost: number;
  procrastinationSignals: string[];
}

export interface UserInterests {
  topics: string[];
  expertise: string[];
  learningGoals: string[];
}

export interface UserHabits {
  goodHabits: string[];
  badHabits: string[];
  routines: DailyRoutine[];
}

export interface DailyRoutine {
  time: string;
  activity: string;
}

export interface UserRelationships {
  frequentContacts: string[];
  communicationPatterns: string[];
  collaborationStyle: string;
}

export interface UserGoals {
  shortTerm: string[];
  longTerm: string[];
  values: string[];
}

// API 接口
export interface SyncRequest {
  events: EncryptedEvent[];
  lastSyncAt: number;
}

export interface EncryptedEvent {
  encryptedData: string;
  iv: string;
  authTag: string;
}

export interface SyncResponse {
  success: boolean;
  processedCount: number;
  serverUpdates?: any[];
}

export interface AnalysisRequest {
  timelineData: Timeline;
  previousPortrait?: UserPortrait;
}

export interface AnalysisResponse {
  portrait: UserPortrait;
  suggestions: string[];
  productivityScore: number;
}
