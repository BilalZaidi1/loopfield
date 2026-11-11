/**
 * Recording evidence model shared by the device recorder, the upload API and validation workers.
 * Samples are append-only; `seq` is assigned by the recorder in arrival order and never reused.
 */

export interface LocationSample {
  /** Monotonic sequence number within one activity (0-based). */
  seq: number;
  /** Fix time reported by the location provider, epoch milliseconds (UTC). */
  t: number;
  /** Device monotonic clock reading (ms) when available; immune to wall-clock edits. */
  mono?: number | null;
  lat: number;
  lng: number;
  /** Horizontal accuracy radius in metres (68% confidence on both platforms), null when unknown. */
  acc: number | null;
  alt?: number | null;
  altAcc?: number | null;
  /** Provider speed (m/s) when available. */
  spd?: number | null;
  hdg?: number | null;
  /** Android reports mock-provider fixes; iOS 15+ reports simulated sources. */
  mocked?: boolean;
}

export type RecordingEventKind =
  | 'start'
  | 'pause'
  | 'resume'
  | 'finish'
  | 'capture_start'
  | 'capture_end'
  | 'speed_start'
  | 'speed_end'
  | 'interrupted'
  | 'recovered'
  | 'permission_lost'
  | 'permission_restored'
  /** The phone's step check: `data.result` = 'no_running_steps' with `data.from`/`data.to` (epoch ms). */
  | 'steps_check'
  /** The phone warned about implausible speed (`data.reason`, `data.kmh`). */
  | 'speed_warning'
  /** The phone paused recording itself (`data.reason`); a normal pause follows. */
  | 'auto_pause';

export interface RecordingEvent {
  /** Sequence number of the last sample persisted before this event (-1 when none). */
  afterSeq: number;
  /** Event time, epoch ms. */
  t: number;
  mono?: number | null;
  kind: RecordingEventKind;
  data?: Record<string, string | number | boolean | null>;
}

export type ActivityMode = {
  /** Territory capture explicitly enabled for this session. */
  territory: boolean;
  /** Speed attempt explicitly enabled for this session. */
  speed: boolean;
};

export interface SessionTicketClaims {
  ticketId: string;
  userId: string;
  modes: ActivityMode;
  competitionId: string;
  seasonId: string;
  courseVersionId: string | null;
  territoryRulesVersion: string;
  speedRulesVersion: string;
  /** Server time anchor (epoch ms) when the ticket was issued. */
  issuedAt: number;
  /** Latest time the competitive interval may start (epoch ms). */
  startBy: number;
}

export interface ActivityEnvelope {
  activityId: string;
  ticket: { claims: SessionTicketClaims; signature: string } | null;
  startedAt: number;
  endedAt: number;
  events: RecordingEvent[];
  sampleCount: number;
  /** sha256 hex over the canonical sample serialisation. */
  evidenceDigest: string;
  device: { platform: 'ios' | 'android'; osVersion: string; model: string | null; appVersion: string };
}
