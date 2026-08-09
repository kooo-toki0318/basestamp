export type Session =
  | { authenticated: false }
  | {
      authenticated: true;
      walletAddress: string;
      chainId: number;
      expiresAt: string;
    };
