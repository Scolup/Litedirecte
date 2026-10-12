// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
export { Litedirecte, CACHE_TTL_MS, type GetAllOptions, type AllData } from './client';
export type { Resource } from './types';
export {
  createMemoryStorage,
  localStorageStorage,
  indexedDBStorage,
  nodeStorage,
  cloudflareKVStorage,
  asyncStorage,
  encryptedStorage,
} from './core/storage';
export { ED_MODULES, type ModuleKey } from './core/modules';
export type { EventHandler, LitedirecteEvent, LitedirecteEvents } from './modules/listen/emitter';

export type {
  EdResponse,
  AccountType,
  Account,
  UserProfile,
  LoginChallenge,
  LoginSuccess,
  LoginResult,
  EdConfig,
  StorageAdapter,
  ErrorMiddleware,
  CloudNode,
  CloudFolderNode,
  CloudFileNode,
  CloudEntry,
} from './types';
export type { LoginOptions } from './auth/index';
export type { GetGradesOptions } from './modules/grades/index';
export type { GetTimetableOptions, TimetableIcalUrlOptions } from './modules/timetable/index';
export type {
  GetHomeworkOptions,
  GetHomeworkForDateOptions,
  HomeworkMutationOptions,
} from './modules/homework/index';
export type {
  GetMessagesOptions,
  GetMessageOptions,
  ContactType,
  GetContactsOptions,
  SendMessageData,
  SendMessageOptions,
  MessageAttachmentRef,
  UploadAttachmentOptions,
  MarkMessageOptions,
} from './modules/messages/index';
export type { TimelineOptions, Correlation, CorrelationType } from './modules/timeline/index';
export type { GetAttendanceOptions } from './modules/attendance/index';
export type { GetCloudOptions, CloudMutationOptions } from './modules/cloud/index';
export type { GetDocumentsOptions } from './modules/documents/index';
export type { QcmOptions, SubmitQcmAnswerParams } from './modules/forms/index';
export type { SettingsOptions, UpdateSettingsData } from './modules/settings/index';
export type { DownloadFormat, DownloadOptions, DownloadPhotoOptions } from './core/downloader';

export * from './core/errors';
