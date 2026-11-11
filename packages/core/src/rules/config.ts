/**
 * Gameplay, validation and privacy thresholds.
 *
 * Every value carries a status:
 *  - "proposed": a working default taken from (or derived from) PRD v1.2. It has NOT been
 *    validated by the field studies required in PRD §14 and §18. Production use requires
 *    calibration evidence before the status may change.
 *  - "validated": reserved for values backed by recorded field evidence. No value is
 *    validated in this release.
 *
 * Seasons pin a rules version; changing a value requires a new version string so that past
 * results can be replayed under the rules that produced them (PRD §17 "Version geometry and
 * timing algorithms separately. Do not silently change past results").
 */

export type ThresholdStatus = 'proposed' | 'validated';

export interface Threshold<T> {
  readonly value: T;
  readonly status: ThresholdStatus;
  /** PRD section or rationale. */
  readonly source: string;
}

const p = <T>(value: T, source: string): Threshold<T> => ({ value, status: 'proposed', source });

export const TERRITORY_RULES_VERSION = 'territory-2026.11.0-proposed';
export const SPEED_RULES_VERSION = 'speed-2026.11.0-proposed';
export const VALIDATION_ALGORITHM_VERSION = 'validation-2026.11.0';
export const TIMING_ALGORITHM_VERSION = 'timing-2026.11.0';

export const TERRITORY_RULES = {
  version: TERRITORY_RULES_VERSION,
  /** Maximum start-to-finish gap for loop closure. PRD §6: "Test a maximum 20-meter start-to-finish gap". */
  closureMaxGapMeters: p(20, 'PRD §6 Territory capture rules — Closure'),
  /** Endpoint fixes must be at least this accurate to count as "reliable endpoint evidence". */
  closureEndpointMaxAccuracyMeters: p(15, 'Derived: PRD §6 requires reliable endpoint evidence; GPS.gov typical 4.9 m open sky (S46)'),
  minLoopLengthMeters: p(1_000, 'PRD §6 Initial operating limits (1 km)'),
  maxLoopLengthMeters: p(30_000, 'PRD §6 Initial operating limits (30 km)'),
  maxCandidateAreaSquareMeters: p(25_000_000, 'PRD §6 Initial operating limits (25 km²)'),
  /** At least one qualifying cell is needed. */
  minEligibleCells: p(1, 'PRD §6 Eligible land'),
  /** Inward uncertainty band removed from the loop edge before awarding fully-contained cells. */
  boundaryUncertaintyBandMeters: p(10, 'PRD §6/§17 calibrated band — 10 m placeholder pending field study'),
  /** H3 resolution of the ownership grid, frozen per season. */
  gridResolution: p(11, 'PRD §17 H3 resolution 11 candidate (average 2,150 m²), test against 10'),
  /** Exploration grid (private visited ground). */
  explorationResolution: p(10, 'Implementation default: coarser private exploration grid'),
  /** Unresolved recording gaps longer than this withhold competitive results. */
  maxSampleGapSeconds: p(10, 'PRD §6 Route matching — ten-second gap rule, applied to loops as well'),
  /** Fixes worse than this are unusable for competitive geometry. */
  maxUsableAccuracyMeters: p(25, 'Implementation default pending field study'),
  /** Minimum share of usable fixes in the competitive interval. */
  minUsableFixShare: p(0.9, 'Implementation default pending field study'),
  /** Polsby-Popper compactness (4πA/P²) below this is treated as a degenerate sliver/out-and-back. */
  minCompactness: p(0.03, 'PRD §6 non-degenerate interior; out-and-back ≈ 0'),
  /** Implied speed between consecutive fixes above which a jump is treated as a GPS discontinuity. */
  maxJumpSpeedMetersPerSecond: p(12, 'Implementation default: faster than any sustained run'),
  /** Sustained speed above which a running classification is doubtful (pending review). */
  suspiciousSustainedSpeedMetersPerSecond: p(6.5, 'PRD §12 driving/cycling labelled as running'),
  suspiciousSustainedSeconds: p(60, 'Implementation default'),
  minSamples: p(30, 'Implementation default'),
  maxRingVertices: p(20_000, 'Processing bound PRD §17'),
  maxCandidateCells: p(15_000, 'Processing bound PRD §17 (25 km² ≈ 11.6k res-11 cells)')
} as const;

export const SPEED_RULES = {
  version: SPEED_RULES_VERSION,
  minCourseLengthMeters: p(1_000, 'PRD §6 Course range — review routes of 1 to 5 km'),
  maxCourseLengthMeters: p(5_000, 'PRD §6 Course range — review routes of 1 to 5 km'),
  corridorMeters: p(20, 'PRD §6 candidate 20-meter corridor'),
  minCoverage: p(0.95, 'PRD §6 at least 95 percent route coverage'),
  checkpointRadiusMeters: p(20, 'Implementation default aligned with corridor'),
  gateMaxFixSpacingSeconds: p(4, 'PRD §6 usable fixes on both sides of a crossing no more than four seconds apart'),
  maxAttemptUncertaintySeconds: p(3, 'PRD §6 estimated timing uncertainty no greater than three seconds per attempt'),
  /** Per-crossing observed field error term added to interpolation uncertainty. */
  fieldErrorSecondsPerCrossing: p(0.5, 'PRD §6 uncertainty combines interpolation and observed field error — placeholder pending reference timing'),
  maxSampleGapSeconds: p(10, 'PRD §6 unresolved gap longer than ten seconds'),
  marginMinSeconds: p(5, 'PRD §6 Winning margin — 5 seconds'),
  marginFraction: p(0.01, 'PRD §6 Winning margin — 1 percent of champion time'),
  gateHalfWidthMeters: p(15, 'Implementation default for published gate line half-width'),
  duplicateRouteMaxHausdorffMeters: p(30, 'PRD §6 duplicate routes — materially equivalent geometry')
} as const;

export const MOVEMENT_RULES_VERSION = 'movement-2026.11.0-proposed';

/**
 * Movement points (new in this release, outside PRD v1.2): verified distance from any run, public or
 * private, earns points that can only be spent reclaiming land the runner lost to another runner's loop.
 * Verification reuses the competitive evidence rules; nothing here is inferred or reconstructed.
 */
export const MOVEMENT_RULES = {
  version: MOVEMENT_RULES_VERSION,
  /** Distance across a recording gap longer than this is not counted (unrecorded movement is never reconstructed). */
  maxCountedGapSeconds: p(10, 'Same ten-second gap rule as competitive intervals (PRD §6)'),
  /** Implied speed between fixes above which the segment is a GPS jump and is not counted. */
  maxJumpSpeedMetersPerSecond: p(12, 'Same as TERRITORY_RULES.maxJumpSpeedMetersPerSecond'),
  /** Sustained speed above this for at least `vehicleSustainedSeconds` is treated as a vehicle and not counted. */
  vehicleSpeedMetersPerSecond: p(6.5, 'Same as TERRITORY_RULES.suspiciousSustainedSpeedMetersPerSecond (PRD §12)'),
  vehicleSustainedSeconds: p(60, 'Same as TERRITORY_RULES.suspiciousSustainedSeconds'),
  minSamples: p(30, 'Same as TERRITORY_RULES.minSamples'),
  /** Runs with less verified distance than this earn nothing. */
  minVerifiedDistanceMeters: p(200, 'Implementation default: ignores accidental starts'),
  /** Defaults mirrored into app_config by migration; the database values are authoritative. */
  pointsPerKm: p(10, 'Implementation default: 1 point per 100 m'),
  dailyPointsCap: p(400, 'Implementation default: 40 km per UTC day, limits farming'),
  /** Reclaim cost per cell = ceil(average cell area in m² / 1000 × this), at least 1 (3 points at resolution 11). */
  reclaimPointsPer1000SquareMeters: p(1, 'Implementation default: running a loop stays far cheaper per cell than points'),
  maxCellsPerReclaim: p(200, 'Processing bound per reclaim request')
} as const;

/** Achievement ranking (independent of movement points). Mirrored into app_config; the database is authoritative. */
export const ACHIEVEMENT_RULES = {
  tierPoints: p({ bronze: 10, silver: 25, gold: 60, platinum: 150 } as const, 'Implementation default'),
  categoryBonus: p(25, 'Implementation default: rewards breadth across challenge categories')
} as const;

export const SEASON_RULES = {
  seasonLengthDays: p(28, 'PRD §6 Use 28-day seasons'),
  lateUploadWindowHours: p(24, 'PRD §6 Accept ranked uploads received within 24 hours of completion'),
  publicationDelayMinutes: p(30, 'PRD §6 Publish permitted results at least 30 minutes after completion'),
  settlementDelayHours: p(24, 'PRD §6 Final season results settle 24 hours after the season ends'),
  ticketStartWindowHours: p(6, 'Implementation default: a ticket must be used within 6 hours of issue'),
  maxClockSkewSeconds: p(120, 'Implementation default for client clock consistency checks')
} as const;

export const RETENTION_RULES = {
  rawEvidenceDaysAfterSettlement: p(30, 'PRD §11 Raw competitive GPS — season and 30 days after settlement'),
  moderationCaseDaysAfterClosure: p(90, 'PRD §11 Support integrity and moderation cases'),
  analyticsMonths: p(13, 'PRD §11 Product analytics'),
  healthCacheDays: p(90, 'PRD §11 Imported health cache up to 90 days on device'),
  exportLinkHours: p(72, 'Implementation default for export download links'),
  appealWindowDays: p(7, 'PRD §12 proposed seven-day window')
} as const;

export const SOCIAL_RULES = {
  maxPhotosPerPost: p(5, 'PRD §9 proposed limit of five compressed photos per post'),
  maxOriginalImageBytes: p(10 * 1024 * 1024, 'PRD §9 10 MB per original image'),
  maxPostBodyChars: p(2_000, 'Implementation default'),
  maxCommentChars: p(1_000, 'Implementation default'),
  maxImageEdgePixels: p(2_048, 'Implementation default for processed derivatives'),
  mediaUrlTtlSeconds: p(300, 'PRD §11 short-lived media references'),
  chatTokenTtlSeconds: p(3_600, 'Implementation default'),
  dailyDigestHourLocal: p(19, 'Implementation default; one aggregated territory update per day (PRD §7)')
} as const;

export const RATE_LIMITS = {
  postsPerHour: 10,
  commentsPerHour: 60,
  reportsPerDay: 20,
  followRequestsPerHour: 60,
  conversationsStartedPerDay: 20,
  routeProposalsPerDay: 5,
  ticketsPerHour: 12,
  uploadChunksPerMinute: 120
} as const;

export function thresholdValues<T extends Record<string, unknown>>(rules: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rules)) {
    out[k] = v && typeof v === 'object' && 'value' in (v as object) ? (v as Threshold<unknown>).value : v;
  }
  return out;
}

export type TerritoryRules = typeof TERRITORY_RULES;
export type SpeedRules = typeof SPEED_RULES;
