export { computeDiff, makeDiff } from './compute';
export type { Diff, DiffContent, ModifiedSection } from './types';
export {
  DIFF_REPORT_VERSION,
  serializeDiff,
  deserializeDiff,
  renderDiffForViewer,
  type DiffReportArtifact,
} from './serialize';
