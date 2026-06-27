import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { ObjectId } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { BaseLocale, StatusBaseLocalEnum } from '../../entities/base_locale.entity';
import { Numero } from '../../entities/numero.entity';
import { Voie, TypeNumerotationEnum } from '../../entities/voie.entity';
import { Toponyme } from '../../entities/toponyme.entity';
import { Position, PositionTypeEnum } from '../../entities/position.entity';
import {
  getJurisdiction,
  getJurisdictionName,
  getState,
} from '../../utils/fips.utils';
import {
  OvertureAddress,
  OvertureAddressInput,
  OvertureImportResult,
  OvertureExportRecord,
  OvertureBulkImportResult,
  OvertureStreetInput,
  OvertureStreetsImportResult,
  MatchConfidence,
  GersMatchResult,
} from './overture.types';

/**
 * Overture Maps Integration Service
 *
 * Provides bidirectional data quality exchange between the National Address
 * Platform (NAP) and the Overture Maps Foundation via GERS IDs.
 *
 * Key capabilities:
 * 1. Link existing NAP addresses to Overture GERS IDs via spatial matching
 * 2. Import new Overture address data into a jurisdiction's LAB
 * 3. Export NAP addresses with GERS IDs for Overture contribution
 * 4. Track provenance metadata for quality feedback loops
 *
 * GERS IDs are UUID v4 identifiers that remain stable across monthly
 * Overture releases, enabling persistent cross-referencing.
 */
@Injectable()
export class OvertureService {
  private readonly logger = new Logger(OvertureService.name);

  constructor(
    @InjectRepository(BaseLocale)
    private readonly baseLocaleRepository: Repository<BaseLocale>,
    @InjectRepository(Numero)
    private readonly numeroRepository: Repository<Numero>,
    @InjectRepository(Voie)
    private readonly voieRepository: Repository<Voie>,
    @InjectRepository(Toponyme)
    private readonly toponymeRepository: Repository<Toponyme>,
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
  ) {}

  // ─── GERS Linking ──────────────────────────────────────────────────────────

  /**
   * Link a GERS ID to an existing address (numero).
   * This is the primary mechanism for establishing cross-references
   * between NAP and Overture.
   */
  async linkGersToNumero(
    numeroId: string,
    gersId: string,
    overtureSource?: Record<string, any>,
  ): Promise<Numero> {
    const numero = await this.numeroRepository.findOneBy({ id: numeroId });
    if (!numero) {
      throw new Error(`Numero ${numeroId} not found`);
    }

    numero.gersId = gersId;
    if (overtureSource) {
      numero.overtureSource = {
        ...overtureSource,
        linkedAt: new Date().toISOString(),
      };
    }

    this.logger.log(
      `Linked GERS ${gersId} → Numero ${numeroId} (${numero.numero})`,
    );
    return this.numeroRepository.save(numero);
  }

  /**
   * Link a GERS ID to a street (voie).
   * Connects NAP streets to Overture transportation segments.
   */
  async linkGersToVoie(voieId: string, gersId: string): Promise<Voie> {
    const voie = await this.voieRepository.findOneBy({ id: voieId });
    if (!voie) {
      throw new Error(`Voie ${voieId} not found`);
    }

    voie.gersId = gersId;
    this.logger.log(`Linked GERS ${gersId} → Voie ${voieId} (${voie.nom})`);
    return this.voieRepository.save(voie);
  }

  /**
   * Link a GERS ID to a place name (toponyme).
   * Connects NAP place names to Overture places.
   */
  async linkGersToToponyme(
    toponymeId: string,
    gersId: string,
  ): Promise<Toponyme> {
    const toponyme = await this.toponymeRepository.findOneBy({
      id: toponymeId,
    });
    if (!toponyme) {
      throw new Error(`Toponyme ${toponymeId} not found`);
    }

    toponyme.gersId = gersId;
    this.logger.log(
      `Linked GERS ${gersId} → Toponyme ${toponymeId} (${toponyme.nom})`,
    );
    return this.toponymeRepository.save(toponyme);
  }

  // ─── Spatial Matching ─────────────────────────────────────────────────────

  /**
   * Match an Overture address against existing NAP addresses within a
   * jurisdiction using PostGIS spatial proximity + name similarity.
   *
   * Returns a match result with confidence level and distance.
   */
  async findMatchingNumero(
    overtureAddress: OvertureAddress,
    balId: string,
  ): Promise<GersMatchResult | null> {
    const [lon, lat] = overtureAddress.geometry.coordinates;
    const street = overtureAddress.properties.street;
    const number = overtureAddress.properties.number;

    if (!street || !number) {
      return null;
    }

    // Find addresses within 100m using PostGIS
    const candidates = await this.numeroRepository
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.positions', 'p')
      .leftJoinAndSelect('n.voie', 'v')
      .where('n.bal_id = :balId', { balId })
      .andWhere('n.numero = :numero', { numero: parseInt(number, 10) || 0 })
      .andWhere('n.deleted_at IS NULL')
      .getMany();

    if (candidates.length === 0) {
      return null;
    }

    // Score candidates by distance and name similarity
    let bestMatch: GersMatchResult | null = null;

    for (const candidate of candidates) {
      if (!candidate.positions?.length || !candidate.voie) continue;

      const pos = candidate.positions[0];
      if (!pos.point?.coordinates) continue;

      const [candLon, candLat] = pos.point.coordinates;
      const distance = haversineDistance(lat, lon, candLat, candLon);

      if (distance > 100) continue; // Skip if beyond 100m

      const nameScore = stringSimilarity(
        street.toLowerCase(),
        candidate.voie.nom.toLowerCase(),
      );

      let confidence: MatchConfidence;
      if (distance < 5 && nameScore > 0.9) {
        confidence = MatchConfidence.EXACT;
      } else if (distance < 25 && nameScore > 0.7) {
        confidence = MatchConfidence.HIGH;
      } else if (distance < 50 && nameScore > 0.5) {
        confidence = MatchConfidence.MEDIUM;
      } else {
        confidence = MatchConfidence.LOW;
      }

      if (
        !bestMatch ||
        confidenceRank(confidence) > confidenceRank(bestMatch.confidence)
      ) {
        bestMatch = {
          gersId: overtureAddress.id,
          confidence,
          overtureAddress,
          distance,
        };
      }
    }

    return bestMatch;
  }

  // ─── Export for Overture Contribution ──────────────────────────────────────

  /**
   * Export addresses from a LAB in Overture-compatible format.
   * Includes GERS IDs where available for update matching.
   */
  async exportForOverture(
    balId: string,
    countyFips: string,
  ): Promise<OvertureExportRecord[]> {
    const jurisdiction = getJurisdiction(countyFips);
    if (!jurisdiction) {
      throw new Error(`Invalid FIPS code: ${countyFips}`);
    }

    const state = getState(jurisdiction.stateFips);

    const numeros = await this.numeroRepository.find({
      where: { balId, deletedAt: IsNull() },
      relations: ['positions', 'voie'],
    });

    return numeros
      .filter((n) => n.positions?.length > 0)
      .map((n) => {
        const pos = n.positions[0];
        const [lon, lat] = pos.point?.coordinates || [0, 0];

        return {
          nap_id: n.id,
          ban_id: n.banId,
          gers_id: n.gersId || null,
          country: 'US' as const,
          state: state?.abbr || jurisdiction.stateAbbr,
          county_fips: countyFips,
          street: n.voie?.nom || '',
          number: n.numero.toString(),
          unit: n.suffixe || undefined,
          longitude: lon,
          latitude: lat,
          certified: n.certifie || false,
          last_updated: n.updatedAt?.toISOString()?.slice(0, 10) || '',
        };
      });
  }

  // ─── Bulk Import from Overture ────────────────────────────────────────────

  /**
   * Bulk-import Overture Maps address data into a new Local Address Base.
   *
   * Flow:
   * 1. Create a new LAB for the given FIPS jurisdiction
   * 2. Group addresses by street name → create Voie records
   * 3. Create Numero records with positions and GERS IDs
   * 4. Calculate Voie centroids from imported positions
   *
   * @param fipsCode 5-digit county or 7-digit place FIPS code
   * @param addresses Array of Overture address records
   * @param email Optional admin email for the LAB
   * @returns Import result summary
   */
  async bulkImportFromOverture(
    params: {
      fipsCode: string;
      addresses: OvertureAddressInput[];
      email?: string;
      release?: string;
      append?: boolean;
      balId?: string;
      token?: string;
    },
  ): Promise<OvertureBulkImportResult> {
    const { fipsCode, addresses, email } = params;
    const release = params.release || 'unknown';
    const startTime = Date.now();

    // Validate jurisdiction
    const jurisdiction = getJurisdiction(fipsCode);
    if (!jurisdiction) {
      throw new Error(`Invalid FIPS code: ${fipsCode}`);
    }
    const jurisdictionName =
      getJurisdictionName(fipsCode) || `Jurisdiction ${fipsCode}`;

    this.logger.log(
      `Overture import for ${jurisdictionName} (${fipsCode}): ` +
        `${addresses.length} addresses` +
        (params.append ? ` [append → LAB ${params.balId}]` : ''),
    );

    // ── Step 1: Resolve target LAB (create new, or append to existing) ───
    let bal: BaseLocale;
    if (params.append) {
      if (!params.balId || !params.token) {
        throw new Error('append requires both balId and token');
      }
      bal = await this.baseLocaleRepository.findOne({
        where: { id: params.balId },
      });
      if (!bal) {
        throw new Error(`Target LAB ${params.balId} not found`);
      }
      if (bal.token !== params.token) {
        throw new Error('Invalid token for append target');
      }
      if (bal.commune !== fipsCode) {
        throw new Error(
          `FIPS mismatch: LAB ${bal.id} is ${bal.commune}, not ${fipsCode}`,
        );
      }
    } else {
      const balEntity = this.baseLocaleRepository.create({
        banId: uuid(),
        token: this.generateToken(20),
        commune: fipsCode,
        nom: `Addresses of ${jurisdictionName}`,
        emails: email ? [email] : ['overture-import@nap.gov'],
        status: StatusBaseLocalEnum.DRAFT,
        settings: {
          languageGoalIgnored: false,
          toponymeGoalIgnored: false,
        },
        overtureImport: {
          release,
          importedAt: new Date().toISOString(),
          chunks: 0,
          addressCount: 0,
        },
      });
      bal = await this.baseLocaleRepository.save(balEntity);
      this.logger.log(`Created LAB ${bal.id} for ${jurisdictionName}`);
    }
    const balId = bal.id;

    // ── Step 2: Group addresses by street → create/reuse Voies ──────────
    const streetMap = new Map<string, {
      voieId: string;
      banId: string;
      nom: string;
      isNew: boolean;
      addresses: OvertureAddressInput[];
    }>();
    let skipped = 0;

    // When appending, pre-load existing streets so new chunks reuse the same
    // voie instead of creating duplicates.
    if (params.append) {
      const existingVoies = await this.voieRepository.find({ where: { balId } });
      for (const v of existingVoies) {
        streetMap.set(v.nom.trim().toUpperCase(), {
          voieId: v.id,
          banId: v.banId,
          nom: v.nom,
          isNew: false,
          addresses: [],
        });
      }
    }

    for (const addr of addresses) {
      // Skip addresses without street or number
      if (!addr.street || !addr.number) {
        skipped++;
        continue;
      }
      // Normalize street name: title case
      const streetKey = addr.street.trim().toUpperCase();
      const streetNom = this.titleCase(addr.street.trim());

      if (!streetMap.has(streetKey)) {
        streetMap.set(streetKey, {
          voieId: new ObjectId().toHexString(),
          banId: uuid(),
          nom: streetNom,
          isNew: true,
          addresses: [],
        });
      }
      streetMap.get(streetKey).addresses.push(addr);
    }

    // Bulk insert only NEW voies in chunks (existing ones are reused on append).
    const voieEntries = Array.from(streetMap.values());
    const newVoieEntries = voieEntries.filter((e) => e.isNew);
    const CHUNK_SIZE = 500;

    for (let i = 0; i < newVoieEntries.length; i += CHUNK_SIZE) {
      const chunk = newVoieEntries.slice(i, i + CHUNK_SIZE);
      const voieValues = chunk.map((entry) => ({
        id: entry.voieId,
        balId,
        banId: entry.banId,
        nom: entry.nom,
        typeNumerotation: TypeNumerotationEnum.NUMERIQUE,
      }));

      await this.voieRepository
        .createQueryBuilder()
        .insert()
        .into(Voie)
        .values(voieValues)
        .execute();
    }

    this.logger.log(
      `Created ${newVoieEntries.length} new streets for LAB ${balId}`,
    );

    // ── Step 3: Create Numeros with Positions ───────────────────────────
    let addressesCreated = 0;
    let positionsCreated = 0;
    let gersIdsLinked = 0;

    // Process by street to keep voie association tight
    for (const entry of voieEntries) {
      const numeroBatch: Partial<Numero>[] = [];
      const positionBatch: Partial<Position>[] = [];

      for (const addr of entry.addresses) {
        const parsed = parseInt(addr.number, 10);
        // Extract number and suffix (e.g., "123A" → number=123, suffix="A")
        const { num, suffix } = this.parseAddressNumber(addr.number);

        if (num === null || num < 0 || num > 99998) {
          skipped++;
          continue;
        }

        const numeroId = new ObjectId().toHexString();
        const positionId = new ObjectId().toHexString();

        numeroBatch.push({
          id: numeroId,
          balId,
          banId: uuid(),
          voieId: entry.voieId,
          numero: num,
          suffixe: suffix || null,
          parcelles: [],
          certifie: false,
          communeDeleguee: null,
          gersId: addr.gersId || null,
          overtureSource: addr.sources?.length
            ? {
                dataset: addr.sources[0].dataset,
                confidence: addr.sources[0].confidence,
                importedAt: new Date().toISOString(),
                release,
              }
            : {
                dataset: 'overture-maps',
                importedAt: new Date().toISOString(),
                release,
              },
        });

        positionBatch.push({
          id: positionId,
          numeroId,
          type: PositionTypeEnum.ENTREE,
          source: 'overture-maps',
          rank: 0,
          point: {
            type: 'Point',
            coordinates: [addr.longitude, addr.latitude],
          } as any,
        });

        addressesCreated++;
        positionsCreated++;
        if (addr.gersId) gersIdsLinked++;
      }

      // Bulk insert numeros in chunks
      for (let i = 0; i < numeroBatch.length; i += CHUNK_SIZE) {
        const chunk = numeroBatch.slice(i, i + CHUNK_SIZE);
        if (chunk.length === 0) continue;
        await this.numeroRepository
          .createQueryBuilder()
          .insert()
          .into(Numero)
          .values(chunk)
          .execute();
      }

      // Bulk insert positions in chunks
      for (let i = 0; i < positionBatch.length; i += CHUNK_SIZE) {
        const chunk = positionBatch.slice(i, i + CHUNK_SIZE);
        if (chunk.length === 0) continue;
        await this.positionRepository
          .createQueryBuilder()
          .insert()
          .into(Position)
          .values(chunk)
          .execute();
      }
    }

    this.logger.log(
      `Created ${addressesCreated} addresses and ${positionsCreated} positions`,
    );

    // ── Step 4: Recompute centroids for streets touched this chunk ──────
    this.logger.log('Calculating street centroids...');
    for (const entry of voieEntries) {
      if (entry.addresses.length === 0) continue;
      await this.calculateVoieCentroid(entry.voieId);
    }

    // ── Step 5: Record import provenance on the LAB (idempotency) ────────
    const prior = bal.overtureImport;
    bal.overtureImport = {
      release,
      importedAt: new Date().toISOString(),
      chunks: (prior?.chunks || 0) + 1,
      addressCount: (prior?.addressCount || 0) + addressesCreated,
    };
    await this.baseLocaleRepository.save(bal);

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `Overture import complete for ${jurisdictionName} in ${(durationMs / 1000).toFixed(1)}s`,
    );

    return {
      balId,
      token: bal.token,
      fipsCode,
      jurisdictionName,
      totalInput: addresses.length,
      streetsCreated: newVoieEntries.length,
      addressesCreated,
      positionsCreated,
      gersIdsLinked,
      skipped,
      durationMs,
    };
  }

  // ─── Streets Fallback (Transportation theme) ──────────────────────────────

  /**
   * Import Overture transportation segments into an existing LAB as editable
   * streets (voies). Each segment becomes a METRIQUE voie carrying its trace
   * (LineString) and GERS ID, so a clerk gets a browsable street network to
   * hang numbers on even when the jurisdiction has no Overture address points.
   *
   * Streets are inserted in chunks; centroids/bboxes are then computed from each
   * trace in a single PostGIS pass (METRIQUE voies derive their centroid from
   * the trace, not from numero positions).
   */
  async importStreetsIntoBal(params: {
    baseLocale: BaseLocale;
    streets: OvertureStreetInput[];
    release?: string;
  }): Promise<OvertureStreetsImportResult> {
    const { baseLocale, streets } = params;
    const balId = baseLocale.id;
    const startTime = Date.now();
    const CHUNK_SIZE = 500;

    let streetsCreated = 0;
    let gersIdsLinked = 0;
    let skipped = 0;

    const voieValues: Partial<Voie>[] = [];
    for (const street of streets) {
      const nom = (street.name || '').trim();
      const coordinates = street.geometry?.coordinates;
      if (!nom || !Array.isArray(coordinates) || coordinates.length < 2) {
        skipped++;
        continue;
      }
      voieValues.push({
        id: new ObjectId().toHexString(),
        balId,
        banId: uuid(),
        nom,
        typeNumerotation: TypeNumerotationEnum.METRIQUE,
        trace: {
          type: 'LineString',
          coordinates,
        } as any,
        gersId: street.gersId || null,
      });
      streetsCreated++;
      if (street.gersId) gersIdsLinked++;
    }

    for (let i = 0; i < voieValues.length; i += CHUNK_SIZE) {
      const chunk = voieValues.slice(i, i + CHUNK_SIZE);
      if (chunk.length === 0) continue;
      await this.voieRepository
        .createQueryBuilder()
        .insert()
        .into(Voie)
        .values(chunk)
        .execute();
    }

    // Compute centroid + bbox from each trace in one pass (METRIQUE voies).
    if (streetsCreated > 0) {
      await this.voieRepository.query(
        `UPDATE voies
            SET centroid = ST_Centroid(trace),
                bbox = ARRAY[
                  ST_XMin(trace), ST_YMin(trace),
                  ST_XMax(trace), ST_YMax(trace)
                ]
          WHERE bal_id = $1
            AND type_numerotation = 'metrique'
            AND trace IS NOT NULL
            AND centroid IS NULL`,
        [balId],
      );
    }

    this.logger.log(
      `Imported ${streetsCreated} streets (${gersIdsLinked} GERS-linked, ` +
        `${skipped} skipped) into LAB ${balId}`,
    );

    return {
      balId,
      fipsCode: baseLocale.commune,
      streetsCreated,
      gersIdsLinked,
      skipped,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Idempotency lookup: find a LAB already imported for (fipsCode, release).
   * Used by the loader's --skip-existing to avoid duplicate imports.
   */
  async findImportedLab(
    fipsCode: string,
    release?: string,
  ): Promise<{
    balId: string;
    token: string;
    release: string;
    addressCount: number;
    chunks: number;
  } | null> {
    const candidates = await this.baseLocaleRepository.find({
      where: { commune: fipsCode },
    });
    const match = candidates.find(
      (b) =>
        b.overtureImport &&
        (!release || b.overtureImport.release === release),
    );
    if (!match || !match.overtureImport) return null;
    return {
      balId: match.id,
      token: match.token,
      release: match.overtureImport.release,
      addressCount: match.overtureImport.addressCount,
      chunks: match.overtureImport.chunks,
    };
  }

  // ─── Bulk Import Helpers ──────────────────────────────────────────────────

  /**
   * Parse "123A" → { num: 123, suffix: "A" }
   * Parse "123" → { num: 123, suffix: null }
   * Parse "abc" → { num: null, suffix: null }
   */
  private parseAddressNumber(raw: string): {
    num: number | null;
    suffix: string | null;
  } {
    if (!raw) return { num: null, suffix: null };
    const trimmed = raw.trim();
    const match = trimmed.match(/^(\d+)\s*(.*)$/);
    if (!match) {
      const asInt = parseInt(trimmed, 10);
      return Number.isNaN(asInt)
        ? { num: null, suffix: null }
        : { num: asInt, suffix: null };
    }
    return {
      num: parseInt(match[1], 10),
      suffix: match[2] ? match[2].trim().toLowerCase() : null,
    };
  }

  /**
   * Title-case a street name: "NORTH MAIN ST" → "North Main St"
   */
  private titleCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/(?:^|\s)\S/g, (char) => char.toUpperCase());
  }

  /**
   * Simple base62 token generator (matches generateBase62String in token.utils).
   */
  private generateToken(length: number): string {
    const chars =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Calculate a Voie centroid from its associated numero positions.
   */
  private async calculateVoieCentroid(voieId: string): Promise<void> {
    try {
      const result = await this.positionRepository
        .createQueryBuilder('p')
        .select('ST_AsGeoJSON(ST_Centroid(ST_Collect(p.point)))', 'centroid')
        .select(
          'ST_XMin(ST_Extent(p.point)), ST_YMin(ST_Extent(p.point)), ST_XMax(ST_Extent(p.point)), ST_YMax(ST_Extent(p.point))',
          'bbox',
        )
        .innerJoin('numeros', 'n', 'n.id = p.numero_id')
        .where('n.voie_id = :voieId', { voieId })
        .andWhere('n.deleted_at IS NULL')
        .getRawOne();

      // Use raw query for centroid calculation
      const centroidResult = await this.positionRepository.query(
        `SELECT ST_AsGeoJSON(ST_Centroid(ST_Collect(p.point))) as centroid,
                ST_XMin(ST_Extent(p.point)) as xmin,
                ST_YMin(ST_Extent(p.point)) as ymin,
                ST_XMax(ST_Extent(p.point)) as xmax,
                ST_YMax(ST_Extent(p.point)) as ymax
         FROM positions p
         INNER JOIN numeros n ON n.id = p.numero_id
         WHERE n.voie_id = $1 AND n.deleted_at IS NULL`,
        [voieId],
      );

      if (centroidResult?.length > 0 && centroidResult[0].centroid) {
        const centroidGeoJSON = JSON.parse(centroidResult[0].centroid);
        const { xmin, ymin, xmax, ymax } = centroidResult[0];

        await this.voieRepository.update(voieId, {
          centroid: centroidGeoJSON,
          bbox:
            xmin != null ? [parseFloat(xmin), parseFloat(ymin), parseFloat(xmax), parseFloat(ymax)] : null,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to calculate centroid for voie ${voieId}: ${err.message}`,
      );
    }
  }

  // ─── Statistics ───────────────────────────────────────────────────────────

  /**
   * Get GERS linking statistics for a LAB.
   */
  async getGersStats(balId: string): Promise<{
    totalAddresses: number;
    withGersId: number;
    withoutGersId: number;
    coveragePercent: number;
  }> {
    const total = await this.numeroRepository.count({
      where: { balId, deletedAt: IsNull() },
    });

    const withGers = await this.numeroRepository.count({
      where: { balId, gersId: Not(IsNull()), deletedAt: IsNull() },
    });

    return {
      totalAddresses: total,
      withGersId: withGers,
      withoutGersId: total - withGers,
      coveragePercent: total > 0 ? Math.round((withGers / total) * 100) : 0,
    };
  }

  /**
   * Find all addresses with GERS IDs in a LAB.
   * Useful for exporting only GERS-linked addresses for Overture contribution.
   */
  async getGersLinkedAddresses(balId: string): Promise<Numero[]> {
    return this.numeroRepository.find({
      where: { balId, gersId: Not(IsNull()), deletedAt: IsNull() },
      relations: ['positions', 'voie'],
    });
  }

  /**
   * Look up an address by its GERS ID across all LABs.
   * Enables reverse lookups from the Overture ecosystem.
   */
  async findByGersId(gersId: string): Promise<Numero | null> {
    return this.numeroRepository.findOne({
      where: { gersId, deletedAt: IsNull() },
      relations: ['positions', 'voie', 'baseLocale'],
    });
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Haversine distance between two points in meters.
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Simple string similarity (Dice coefficient).
 * Returns 0-1 where 1 = identical.
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.substring(i, i + 2));
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.substring(i, i + 2))) {
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

function confidenceRank(confidence: MatchConfidence): number {
  switch (confidence) {
    case MatchConfidence.EXACT:
      return 4;
    case MatchConfidence.HIGH:
      return 3;
    case MatchConfidence.MEDIUM:
      return 2;
    case MatchConfidence.LOW:
      return 1;
    default:
      return 0;
  }
}
