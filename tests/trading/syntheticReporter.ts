import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { finishSyntheticReport, recordSyntheticCase, syntheticCase, writeSyntheticReport,
  type SyntheticReport } from './syntheticRegression.ts';

export default class SyntheticReporter implements Reporter {
  private pending = Promise.resolve();
  private options: { outputDir: string; report: SyntheticReport };
  constructor(options: { outputDir: string; report: SyntheticReport }) { this.options = options; }

  onTestEnd(test: TestCase, result: TestResult) {
    // Only public source-case identity and outcome leave the browser runner.
    // Error text, wallet requests, transaction bodies and receipt objects do not.
    const row = syntheticCase(test.location.file, test.titlePath().slice(1).join(' > '), result.status, result.duration);
    this.pending = this.pending.then(async () => {
      recordSyntheticCase(this.options.report, row);
      await writeSyntheticReport(this.options.outputDir, this.options.report);
    });
  }

  async onEnd(result: FullResult) {
    await this.pending;
    finishSyntheticReport(this.options.report, result.status);
    await writeSyntheticReport(this.options.outputDir, this.options.report);
  }
}
