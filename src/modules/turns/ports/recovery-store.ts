
export interface RecoveryStore {
  recoverInterrupted(now: Date): { turns: number; outbox: number };
}
