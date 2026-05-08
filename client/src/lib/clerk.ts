let _publishableKey: string | null = null;
let _clerk: any = null;
let _ready = false;

export async function loadConfig(): Promise<void> {
  if (_publishableKey !== null) return;
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json() as { clerkPublishableKey?: string };
      _publishableKey = data.clerkPublishableKey || null;
    }
  } catch {
    _publishableKey = null;
  }
}

export function isClerkMode(): boolean {
  return !!_publishableKey;
}

export async function initClerk(): Promise<any> {
  if (!_publishableKey) return null;
  if (_clerk && _ready) return _clerk;

  if (!(window as any).__clerk_loaded) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
      script.crossOrigin = 'anonymous';
      // Pass the key via attribute so Clerk doesn't auto-init without it
      script.setAttribute('data-clerk-publishable-key', _publishableKey!);
      script.onload = () => { (window as any).__clerk_loaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load Clerk'));
      document.head.appendChild(script);
    });
  }

  // Use the existing global instance if Clerk auto-initialized from the attribute
  const ClerkCtor = (window as any).Clerk;
  if (!ClerkCtor) throw new Error('Clerk not available');

  // If already instantiated as a singleton (Clerk v5 CDN behavior), use it directly
  if (ClerkCtor && typeof ClerkCtor === 'object' && typeof ClerkCtor.load === 'function') {
    _clerk = ClerkCtor;
  } else {
    _clerk = new ClerkCtor(_publishableKey);
  }

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
