const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

let _clerk: any = null;
let _ready = false;

export function isClerkMode(): boolean {
  return !!publishableKey;
}

export async function initClerk(): Promise<any> {
  if (!publishableKey) return null;
  if (_clerk && _ready) return _clerk;

  if (!(window as any).__clerk_loaded) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => { (window as any).__clerk_loaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load Clerk'));
      document.head.appendChild(script);
    });
  }

  const ClerkCtor = (window as any).Clerk;
  if (!ClerkCtor) throw new Error('Clerk not available');
  _clerk = new ClerkCtor(publishableKey);
  await _clerk.load();
  _ready = true;
  return _clerk;
}

export function getClerk(): any {
  return _clerk;
}

export async function getClerkToken(): Promise<string | null> {
  if (!_clerk || !_ready) return null;
  return _clerk.session?.getToken() ?? null;
}
