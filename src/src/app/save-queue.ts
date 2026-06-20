export type QueuedSaveOperation<T> = () => Promise<T>;
export type LatestSaveOperation<T> = (value: T) => Promise<void>;

export class PerKeySaveQueue<T> {
  private readonly pendingOperations = new Map<string, Promise<T>>();

  public constructor(private readonly recoveryResult: T) {}

  public enqueue(key: string, operation: QueuedSaveOperation<T>): Promise<T> {
    const previousOperation = this.pendingOperations.get(key);
    const currentOperation = (previousOperation ?? Promise.resolve(this.recoveryResult))
      .catch(() => this.recoveryResult)
      .then(operation);

    this.pendingOperations.set(key, currentOperation);

    return currentOperation.finally(() => {
      if (this.pendingOperations.get(key) === currentOperation) {
        this.pendingOperations.delete(key);
      }
    });
  }
}

export class DebouncedLatestSave<T> {
  private hasPendingValue = false;
  private pendingValue!: T;
  private pendingTimer: number | null = null;
  private isSaving = false;
  private activeSave: Promise<void> | null = null;
  private operation: LatestSaveOperation<T> | null = null;
  private onError: ((error: unknown) => void) | null = null;

  public constructor(private readonly delayMs: number) {}

  public schedule(
    value: T,
    operation: LatestSaveOperation<T>,
    onError?: (error: unknown) => void,
  ): void {
    this.hasPendingValue = true;
    this.pendingValue = value;
    this.operation = operation;
    this.onError = onError ?? null;
    this.resetTimer();
  }

  public flush(): Promise<void> | void {
    this.cancelTimer();
    const pendingSave = this.flushPendingValue();

    if (pendingSave || this.activeSave) {
      return this.waitForIdle();
    }
  }

  private resetTimer(): void {
    this.cancelTimer();
    this.pendingTimer = globalThis.setTimeout(() => {
      this.pendingTimer = null;
      this.flushPendingValue();
    }, this.delayMs);
  }

  private cancelTimer(): void {
    if (this.pendingTimer === null) {
      return;
    }

    globalThis.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private flushPendingValue(): Promise<void> | void {
    if (this.isSaving || !this.hasPendingValue || !this.operation) {
      return;
    }

    const value = this.pendingValue;
    const operation = this.operation;
    this.hasPendingValue = false;
    this.isSaving = true;

    const save = Promise.resolve()
      .then(() => operation(value))
      .catch((error: unknown) => {
        this.onError?.(error);
      })
      .finally(() => {
        this.isSaving = false;
        if (this.hasPendingValue && this.pendingTimer === null) {
          this.flushPendingValue();
        }
        if (this.activeSave === save) {
          this.activeSave = null;
        }
      });

    this.activeSave = save;
    void save;
    return save;
  }

  private async waitForIdle(): Promise<void> {
    while (this.activeSave) {
      await this.activeSave;
    }
  }
}
