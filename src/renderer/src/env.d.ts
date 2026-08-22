/// <reference types="vite/client" />
import type { QingwuApi } from '../../shared/types';

declare global {
  interface Window {
    qingwu: QingwuApi;
  }
}

export {};
