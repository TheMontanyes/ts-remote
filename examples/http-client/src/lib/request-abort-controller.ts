export class RequestAbortController {
  private controllers: AbortController[] = [];

  createSignal(): AbortSignal {
    const controller = new AbortController();
    this.controllers.push(controller);
    return controller.signal;
  }

  abortAll(reason?: unknown): void {
    this.controllers.forEach((controller) => {
      controller.abort(reason);
    });
    this.controllers = [];
  }

  abortLast(reason?: unknown): void {
    const last = this.controllers.pop();
    if (last) {
      last.abort(reason);
    }
  }

  abortFirst(reason?: unknown): void {
    const first = this.controllers.shift();
    if (first) {
      first.abort(reason);
    }
  }

  abortSelected(numberRequest: number, reason?: unknown): void {
    const [selected] = this.controllers.splice(numberRequest - 1, 1);
    if (selected) {
      selected.abort(reason);
    }
  }
}
