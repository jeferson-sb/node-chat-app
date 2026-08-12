export type ChatUser = {
  username: string;
  room: string;
  socketId: string;
  /**
   * Whether this user currently has a live connection to this room.
   * Membership records survive disconnects (see
   * docs/adr/2026-08-12-presence-indicators.md), so `online` - not
   * presence/absence of the record - is what drives the sidebar's
   * online/offline indicator.
   */
  online: boolean;
};
