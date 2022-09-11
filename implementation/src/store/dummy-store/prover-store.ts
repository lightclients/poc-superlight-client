import { ContainerType, ListCompositeType } from '@chainsafe/ssz';
import { ISyncStoreProver } from '../isync-store.js';
import { getRandomInt } from '../../utils.js';
import { DummyUpdateRaw, DummyUpdate, CommitteeChainInfo } from './types.js';
import { fromRawUpdate, generateChain } from './utils.js';
import { getUpdateSSZ } from './ssz.js';

export class DummyStoreProver implements ISyncStoreProver<DummyUpdate> {
  startPeriod: number = 0;
  honestCommitteeChain: CommitteeChainInfo;
  dishonestCommitteeChain: CommitteeChainInfo | null = null; // set to null if the prover is honest
  dishonestyIndex: number = -1; // default set to -1 which implies honest prover
  updateSSZ: ContainerType<any>;

  constructor(
    protected honest: boolean = true,
    protected maxChainSize: number = 100,
    protected committeeSize: number = 10,
    protected seed: string = 'seedme',
  ) {
    this.updateSSZ = getUpdateSSZ(committeeSize);
  }

  init() {
    this.honestCommitteeChain = generateChain(
      this.seed + '0',
      this.maxChainSize,
      this.committeeSize,
    );
    if (!this.honest) {
      this.dishonestCommitteeChain = generateChain(
        false,
        this.maxChainSize,
        this.committeeSize,
      );
      this.dishonestyIndex = getRandomInt(this.maxChainSize);
      console.log(`Dishonesty index ${this.dishonestyIndex}`);
    }
  }

  private get syncCommitteeHashes() {
    return this.dishonestCommitteeChain
      ? [
          ...this.honestCommitteeChain.syncCommitteeHashes.slice(
            0,
            this.dishonestyIndex,
          ),
          ...this.dishonestCommitteeChain.syncCommitteeHashes.slice(
            this.dishonestyIndex,
          ),
        ]
      : this.honestCommitteeChain.syncCommitteeHashes;
  }

  private get genesisCommittee() {
    return this.dishonestCommitteeChain && this.dishonestyIndex === 0
      ? this.dishonestCommitteeChain.genesisCommittee
      : this.honestCommitteeChain.genesisCommittee;
  }

  getSyncUpdate(period: number): DummyUpdate {
    const rawUpdate =
      this.dishonestCommitteeChain && this.dishonestyIndex <= period
        ? this.dishonestCommitteeChain.syncUpdatesRaw[period]
        : this.honestCommitteeChain.syncUpdatesRaw[period];
    return fromRawUpdate(
      this.updateSSZ.deserialize(rawUpdate) as DummyUpdateRaw,
    );
  }

  getAllSyncCommitteeHashes(): {
    startPeriod: number;
    hashes: Uint8Array[];
  } {
    return {
      startPeriod: this.startPeriod,
      hashes: this.syncCommitteeHashes,
    };
  }

  getSyncCommittee(period: number): Uint8Array[] {
    if (period === 0) return this.genesisCommittee;
    return this.getSyncUpdate(period - 1).header.nextCommittee;
  }

  updatesToBytes(update: DummyUpdate[], maxItems: number): Uint8Array {
    return new ListCompositeType(this.updateSSZ, maxItems).serialize(update);
  }

  updateChainSize(chainSize: number) {
    if (!this.dishonestCommitteeChain) return;
    this.dishonestyIndex = getRandomInt(chainSize);
    console.log(`Dishonesty index updated ${this.dishonestyIndex}`);
  }
}
