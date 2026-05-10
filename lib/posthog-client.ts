"use client";

export const analytics = {
  capture(..._args: [event: string, properties?: Record<string, unknown>]) {
    void _args;
    return;
  },
  identify(..._args: [distinctId: string, properties?: Record<string, unknown>]) {
    void _args;
    return;
  },
  reset() {
    return;
  },
};
