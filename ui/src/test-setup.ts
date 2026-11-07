import '@testing-library/jest-dom/vitest';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {};
}

class MockWebSocket {
  url: string;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
  }

  send(_data: any) {}
  close() {
    this.readyState = 3;
  }
}

globalThis.WebSocket = MockWebSocket as any;
