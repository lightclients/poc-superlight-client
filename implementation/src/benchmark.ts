export class Benchmark {
  protected interactions = 0;
  protected bytesDownloaded = 0;
  protected bytesUploaded = 0;
  protected startTime = 0;

  public startBenchmark() {
    this.interactions = 0;
    this.bytesDownloaded = 0;
    this.bytesUploaded = 0;
    this.startTime = Date.now();
  }

  public stopBenchmark() {
    return {
      interactions: this.interactions,
      bytesDownloaded: this.bytesDownloaded,
      bytesUploaded: this.bytesUploaded,
      timeToSync: Date.now() - this.startTime,
    };
  }

  public increment(bytesDownloaded: number, bytesUploaded: number) {
    this.interactions += 1;
    this.bytesDownloaded += bytesDownloaded;
    this.bytesUploaded += bytesUploaded;
  }
}
