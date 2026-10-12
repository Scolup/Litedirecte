// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
export interface EdResponse<T> {
  host: string;
  code: number;
  token?: string;
  message: string;
  data: T;
}

export type AccountType = 'E' | 'P' | 'A' | 'F';

export interface Account {
  idLogin: number;
  id: number;
  uid: string;
  identifiant: string;
  typeCompte: AccountType;
  prenom: string;
  nom: string;
  email: string;
  nomEtablissement: string;
  main: boolean;
  accessToken?: string;
  profile: {
    sexe: 'M' | 'F';
    photo: string;
    classe?: {
      id: number;
      code: string;
      libelle: string;
    };
  };
  modules: Array<{
    code: string;
    enable: boolean;
    badge: number;
    params: Record<string, any>;
  }>;
}

export interface UserProfile {
  token: string;
  accounts: Account[];
}

export interface LoginChallenge {
  type: 'securityQuestion';
  question: string;
  choices: string[];
  answer: (choiceIndexOrText: number | string) => Promise<LoginSuccess>;
}

export interface LoginSuccess {
  type: 'success';
  user: Account;
  token: string;
  sessionId: string;
}

export type LoginResult = LoginChallenge | LoginSuccess;

export type Resource =
  | 'grades'
  | 'timetable'
  | 'homework'
  | 'messages'
  | 'timeline'
  | 'commonTimeline'
  | 'attendance'
  | 'settings'
  | 'qcms'
  | 'documents'
  | 'cloud';

export interface EdConfig {
  userAgent?: string;
  proxyUrl?: string;
  maxRetries?: number;
  retryDelay?: number;
  concurrency?: number;
  timeout?: number;
  /**
   * Poll interval in seconds for the built-in `getAll` poller. Default `60`.
   * `0` disables the timer. Otherwise a finite number `>= 5`.
   */
  fetchInterval?: number;
  /**
   * Resources skipped by the login/switch prefetch and by every poll tick.
   * Same values and validation as `getAll({ ignore })`. Default `[]`.
   */
  fetchIgnore?: Resource[];
  /** Online probe. Default: `navigator.onLine` where available, else online. */
  isOnline?: () => boolean;
  storage?: StorageAdapter;
  passkey?: string;
  offlineQueue?: boolean;
  onError?: ErrorMiddleware;
  on2faRequired?: (
    question: string,
    choices: string[],
  ) => number | string | Promise<number | string>;
  onCredentialsRequired?: () =>
    | { identifiant: string; motdepasse: string }
    | Promise<{ identifiant: string; motdepasse: string }>;
  /**
   * Prefix applied to every persisted storage key, so several instances can
   * share one storage adapter without overwriting each other. Default `''`.
   * Must be a string without whitespace.
   */
  storageNamespace?: string;
  /**
   * At most N request starts per rolling 60 seconds (sliding window).
   * Excess requests wait in FIFO order. `0` disables the limit.
   * Default `100` (conservative guess, EcoleDirecte's real limit is unknown).
   */
  maxRequestsPerMinute?: number;
}

export interface StorageAdapter {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

/** Plain observer called with errors that are reported, never retried through it. */
export type ErrorMiddleware = (error: any) => void | Promise<void>;

export interface CloudNode {
  id: string;
  type: 'file' | 'folder';
  libelle: string;
  date: string;
  taille: number;
  readonly: boolean;
  hidden: boolean;
  isTrash: boolean;
  isLoaded?: boolean;
  quota?: number;
  displayText?: string;
  children?: CloudNode[];
  proprietaire?: {
    id: number;
    type: string;
    nom: string;
    prenom: string;
    particule: string;
  };
}

export interface CloudFolderNode extends CloudNode {
  type: 'folder';
  children: CloudNode[];
}

export interface CloudFileNode extends CloudNode {
  type: 'file';
}

export type CloudEntry = CloudFolderNode | CloudFileNode;
