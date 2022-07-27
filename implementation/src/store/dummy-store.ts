import { PublicKey, SecretKey, Signature } from '@chainsafe/bls';
import { ISyncStoreProver, ISyncStoreVerifer } from './isync-store';
import {
  RandomBytesGenerator,
  concatUint8Array,
  numberToUint8Array,
  isUint8ArrayEq,
  getRandomInt,
} from '../utils';
import { digest } from '@chainsafe/as-sha256';
import { fromHexString, toHexString } from '@chainsafe/ssz';

export type Committee = Uint8Array[];
type CommitteeOptimised = ArrayBufferLike[];

export type DummyHeader = {
  nextCommittee: Committee;
  epoch: number;
};

// The optimised data structures uses less memory
type DummyHeaderOptimised = {
  nextCommittee: CommitteeOptimised;
  epoch: number;
};

export type DummyUpdate = {
  header: DummyHeader;
  aggregateSignature: Uint8Array;
};

// The optimised data structures uses less memory
type DummyUpdateOptimised = {
  header: DummyHeaderOptimised;
  aggregateSignature: ArrayBufferLike;
};

function hashHeader(header: DummyHeader): Uint8Array {
  return digest(
    concatUint8Array([
      ...header.nextCommittee,
      numberToUint8Array(header.epoch),
    ]),
  );
}

function toOptimisedUpdate(update: DummyUpdate): DummyUpdateOptimised {
  return {
    header: {
      epoch: update.header.epoch,
      nextCommittee: update.header.nextCommittee.map(u => u.buffer),
    },
    aggregateSignature: update.aggregateSignature.buffer,
  };
}

function fromOptimisedUpdate(update: DummyUpdateOptimised): DummyUpdate {
  return {
    header: {
      epoch: update.header.epoch,
      nextCommittee: update.header.nextCommittee.map(u => new Uint8Array(u)),
    },
    aggregateSignature: new Uint8Array(update.aggregateSignature),
  };
}

export class DummyStoreProver implements ISyncStoreProver<DummyUpdate> {
  startPeriod: number;
  syncUpdatesOptimised: DummyUpdateOptimised[];
  syncCommitteeHashes: Uint8Array[];
  genesisCommittee: Uint8Array[];

  constructor(
    honest: boolean = true,
    size: number = 100,
    committeeSize: number = 10,
    seed: string = 'seedme',
  ) {
    // generate committee using seed
    const randomBytesGenerator = new RandomBytesGenerator(seed);

    const nextCommitteePK = (isMalicious: boolean = false) =>
      isMalicious
        ? new Array(committeeSize).fill(null).map(i => SecretKey.fromKeygen())
        : randomBytesGenerator
            .generateArray(32, committeeSize)
            .map(entropy => SecretKey.fromKeygen(entropy));
    const getCommitteeFromPK = (cPK: SecretKey[]) =>
      cPK.map(pk => pk.toPublicKey().toBytes());
    const getCommitteeHash = (c: Uint8Array[]) => digest(concatUint8Array(c));

    let currentCommitteePK = nextCommitteePK();
    this.genesisCommittee = getCommitteeFromPK(currentCommitteePK);
    this.syncCommitteeHashes = [getCommitteeHash(this.genesisCommittee)];

    // index staring which the store will be dishonest
    const dishonestyIndex = honest ? size : getRandomInt(size);
    if (!honest) console.log(`Dishonesty index ${dishonestyIndex}`);

    // generate dummy sync updates
    this.syncUpdatesOptimised = new Array(size).fill(null).map((_, i) => {
      console.log(`Creating syncUpdates for period ${i}`);
      const nextSyncCommitteePK = nextCommitteePK(i >= dishonestyIndex);
      const nextCommittee = getCommitteeFromPK(nextSyncCommitteePK);
      this.syncCommitteeHashes.push(getCommitteeHash(nextCommittee));

      const header = {
        nextCommittee: nextCommittee,
        epoch: i,
      };

      let aggregateSignature: Uint8Array;
      if (i === dishonestyIndex) {
        aggregateSignature = new Uint8Array(96);
      } else {
        // generate correct signature for honest updates
        const headerHash = hashHeader(header);
        const signatures = currentCommitteePK.map(pk => pk.sign(headerHash));
        aggregateSignature = Signature.aggregate(signatures).toBytes();
      }

      currentCommitteePK = nextSyncCommitteePK;
      const update = {
        header,
        aggregateSignature,
      };
      return toOptimisedUpdate(update);
    });

    this.startPeriod = 0;
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
    return this.syncUpdatesOptimised[period - 1].header.nextCommittee.map(
      b => new Uint8Array(b),
    );
  }

  getSyncUpdate(period: number): DummyUpdate {
    return fromOptimisedUpdate(this.syncUpdatesOptimised[period]);
  }

  updateToJson(update: DummyUpdate): any {
    return {
      header: {
        nextCommittee: update.header.nextCommittee.map(c => toHexString(c)),
        epoch: update.header.epoch,
      },
      aggregateSignature: toHexString(update.aggregateSignature),
    };
  }
}

export class DummyStoreVerifier implements ISyncStoreVerifer<DummyUpdate> {
  genesisSyncCommittee: Uint8Array[];
  genesisPeriod: number;

  constructor(
    protected size: number = 100,
    committeeSize: number = 10,
    genesisSeed: string = 'seedme',
  ) {
    // generate genesis committee using genesis seed
    const randomBytesGenerator = new RandomBytesGenerator(genesisSeed);
    const genesisCommitteePK = randomBytesGenerator
      .generateArray(32, committeeSize)
      .map(entropy => SecretKey.fromKeygen(entropy));
    this.genesisSyncCommittee = genesisCommitteePK.map(pk =>
      pk.toPublicKey().toBytes(),
    );
    this.genesisPeriod = 0;
  }

  syncUpdateVerify(
    prevCommittee: Uint8Array[],
    currentCommittee: Uint8Array[],
    update: DummyUpdate,
  ): boolean {
    // verify if the current committee is same as update next committee
    const isCurrentCommitteeSame = currentCommittee.every((c, i) =>
      isUint8ArrayEq(c, update.header.nextCommittee[i]),
    );
    if (!isCurrentCommitteeSame) return false;

    // verify if the aggregate signature is valid
    const headerHash = hashHeader(update.header);
    const committeeKeys = prevCommittee.map(pk => PublicKey.fromBytes(pk));
    try {
      const isAggregateSignatureValid = Signature.fromBytes(
        update.aggregateSignature,
      ).verifyAggregate(committeeKeys, headerHash);
      return isAggregateSignatureValid;
    } catch (e) {
      // console.error(`Signature Validation Failed ${e}`);
      return false;
    }
  }

  getGenesisSyncCommittee(): Uint8Array[] {
    return this.genesisSyncCommittee;
  }

  getCurrentPeriod(): number {
    return this.genesisPeriod + this.size;
  }

  getGenesisPeriod(): number {
    return this.genesisPeriod;
  }

  updateFromJson(jsonUpdate: any): DummyUpdate {
    return {
      header: {
        nextCommittee: jsonUpdate.header.nextCommittee.map((c: string) =>
          fromHexString(c),
        ),
        epoch: jsonUpdate.header.epoch,
      },
      aggregateSignature: fromHexString(jsonUpdate.aggregateSignature),
    };
  }
}
