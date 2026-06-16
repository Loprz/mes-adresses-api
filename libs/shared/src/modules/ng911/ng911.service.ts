import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BaseLocale } from '../../entities/base_locale.entity';
import { Numero } from '../../entities/numero.entity';
import { Voie } from '../../entities/voie.entity';
import { NumeroNg911 } from '../../entities/numero_ng911.entity';
import { getCounty, getState } from '../../utils/fips.utils';
import { parseStreetName } from '../../utils/street_parser.util';

const NGUID_DOMAIN = process.env.NG911_NGUID_DOMAIN || 'addresses.nap.gov';

/**
 * position.type (PositionTypeEnum, French BAN values) → NENA Placement domain.
 */
const PLACEMENT_MAP: Record<string, string> = {
  'entrée': 'Entrance',
  'bâtiment': 'Structure',
  'cage d’escalier': 'Structure',
  'logement': 'Structure',
  'service technique': 'Site',
  'délivrance postale': 'Site',
  'parcelle': 'Parcel',
  'segment': 'Site',
};

type SsapRow = Record<string, string | number>;

@Injectable()
export class Ng911Service {
  private readonly logger = new Logger(Ng911Service.name);

  constructor(
    @InjectRepository(BaseLocale)
    private readonly balRepo: Repository<BaseLocale>,
    @InjectRepository(Voie) private readonly voieRepo: Repository<Voie>,
    @InjectRepository(Numero) private readonly numeroRepo: Repository<Numero>,
    @InjectRepository(NumeroNg911)
    private readonly ngRepo: Repository<NumeroNg911>,
  ) {}

  // ─── Site/Structure Address Point export ──────────────────────────────────

  async exportSsap(balId: string): Promise<{ filename: string; csv: string }> {
    const bal = await this.balRepo.findOne({ where: { id: balId } });
    if (!bal) throw new NotFoundException(`LAB ${balId} not found`);

    const stateFips = bal.commune.slice(0, 2);
    const countyFips = bal.commune.slice(0, 5);
    const state = getState(stateFips);
    const county = getCounty(countyFips);

    const voies = await this.voieRepo.find({ where: { balId } });
    const voieNom = new Map(voies.map((v) => [v.id, v.nom]));

    const numeros = await this.numeroRepo.find({
      where: { balId },
      relations: { positions: true },
    });
    const ext = await this.loadExtensions(numeros.map((n) => n.id));

    const rows: SsapRow[] = [];
    for (const n of numeros) {
      const pos = (n.positions || []).sort((a, b) => a.rank - b.rank)[0];
      const [lon, lat] = this.pointCoords(pos?.point);
      if (lon === null || lat === null) continue;

      const parsed = parseStreetName(voieNom.get(n.voieId) || '');
      const e = ext.get(n.id);

      rows.push({
        Site_NGUID: e?.siteNguid || `${n.banId}@${NGUID_DOMAIN}`,
        DiscrpAgID: e?.discrpAgId || '',
        DateUpdate: this.isoDate(n.updatedAt),
        Country: 'US',
        State: state?.abbr || '',
        County: county?.name || '',
        Inc_Muni: e?.incMuni || '',
        Uninc_Comm: e?.unincComm || '',
        Nbrhd_Comm: e?.nbrhdComm || '',
        AddNum_Pre: e?.addNumPre || '',
        Add_Number: n.numero === 99999 ? '' : n.numero,
        AddNum_Suf: n.suffixe || '',
        St_PreDir: e?.stPreDir ?? parsed.preDir,
        St_PreTyp: e?.stPreTyp ?? parsed.preType,
        St_Name: e?.stName ?? parsed.name,
        St_PosTyp: e?.stPosTyp ?? parsed.postType,
        St_PosDir: e?.stPosDir ?? parsed.postDir,
        ESN: e?.esn || '',
        MSAGComm: e?.msagComm || '',
        Post_Comm: e?.postComm || '',
        Post_Code: '', // ZIP is derived at geocode time; not stored on the numero
        Post_Code4: e?.postCode4 || '',
        Building: e?.building || '',
        Floor: e?.floor || '',
        Unit: e?.unit || '',
        Room: e?.room || '',
        Seat: e?.seat || '',
        Addtl_Loc: e?.addtlLoc || '',
        LandmkName: e?.landmkName || '',
        Place_Type: e?.placeType || '',
        Placement: e?.placement || PLACEMENT_MAP[pos?.type || ''] || '',
        Long: lon,
        Lat: lat,
        Elev: e?.elev ?? '',
      });
    }

    this.logger.log(`SSAP export for LAB ${balId}: ${rows.length} rows`);
    return {
      filename: `ssap_${bal.commune}.csv`,
      csv: toCsv(SSAP_COLUMNS, rows),
    };
  }

  // ─── Road Centerline address ranges ───────────────────────────────────────

  async exportCenterline(
    balId: string,
  ): Promise<{ filename: string; csv: string; geometryGrounded: number; parityOnly: number }> {
    const bal = await this.balRepo.findOne({ where: { id: balId } });
    if (!bal) throw new NotFoundException(`LAB ${balId} not found`);

    const voies = await this.voieRepo.find({ where: { balId } });
    const numeros = await this.numeroRepo.find({
      where: { balId },
      relations: { positions: true },
    });

    const byVoie = new Map<string, Numero[]>();
    for (const n of numeros) {
      if (n.numero === 99999) continue;
      (byVoie.get(n.voieId) || byVoie.set(n.voieId, []).get(n.voieId))!.push(n);
    }

    const rows: SsapRow[] = [];
    let geometryGrounded = 0;
    let parityOnly = 0;

    for (const v of voies) {
      const nums = byVoie.get(v.id);
      if (!nums || nums.length === 0) continue;
      const parsed = parseStreetName(v.nom);
      const traceCoords = this.lineCoords(v.trace);

      if (traceCoords && traceCoords.length >= 2) {
        // True NG911 L/R ranges from the centerline geometry.
        const sides: Record<'L' | 'R', number[]> = { L: [], R: [] };
        for (const n of nums) {
          const pos = (n.positions || []).sort((a, b) => a.rank - b.rank)[0];
          const [lon, lat] = this.pointCoords(pos?.point);
          if (lon === null || lat === null) continue;
          sides[sideOfLine(traceCoords, lon, lat)].push(n.numero);
        }
        const L = rangeAndParity(sides.L);
        const R = rangeAndParity(sides.R);
        rows.push({
          St_PreDir: parsed.preDir, St_Name: parsed.name,
          St_PosTyp: parsed.postType, St_PosDir: parsed.postDir,
          FromAddr_L: L.from, ToAddr_L: L.to, Parity_L: L.parity,
          FromAddr_R: R.from, ToAddr_R: R.to, Parity_R: R.parity,
          Method: 'geometry',
        });
        geometryGrounded++;
      } else {
        // No centerline geometry → parity-split ranges (odd/even) without side.
        const all = nums.map((n) => n.numero);
        const odd = rangeAndParity(all.filter((x) => x % 2 === 1));
        const even = rangeAndParity(all.filter((x) => x % 2 === 0));
        rows.push({
          St_PreDir: parsed.preDir, St_Name: parsed.name,
          St_PosTyp: parsed.postType, St_PosDir: parsed.postDir,
          FromAddr_L: odd.from, ToAddr_L: odd.to, Parity_L: 'odd',
          FromAddr_R: even.from, ToAddr_R: even.to, Parity_R: 'even',
          Method: 'parity-only',
        });
        parityOnly++;
      }
    }

    this.logger.log(
      `Centerline export for LAB ${balId}: ${rows.length} streets ` +
        `(${geometryGrounded} geometry, ${parityOnly} parity-only)`,
    );
    return {
      filename: `centerline_${bal.commune}.csv`,
      csv: toCsv(CENTERLINE_COLUMNS, rows),
      geometryGrounded,
      parityOnly,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async loadExtensions(ids: string[]): Promise<Map<string, NumeroNg911>> {
    if (ids.length === 0) return new Map();
    const ext = await this.ngRepo.find({ where: { numeroId: In(ids) } });
    return new Map(ext.map((e) => [e.numeroId, e]));
  }

  private pointCoords(point: any): [number | null, number | null] {
    const c = point?.coordinates;
    return Array.isArray(c) && c.length >= 2 ? [c[0], c[1]] : [null, null];
  }

  private lineCoords(line: any): number[][] | null {
    const c = line?.coordinates;
    return Array.isArray(c) && c.length >= 2 ? c : null;
  }

  private isoDate(d?: Date): string {
    return d ? new Date(d).toISOString().slice(0, 10) : '';
  }
}

// ─── module-level pure helpers ──────────────────────────────────────────────

const SSAP_COLUMNS = [
  'Site_NGUID', 'DiscrpAgID', 'DateUpdate', 'Country', 'State', 'County',
  'Inc_Muni', 'Uninc_Comm', 'Nbrhd_Comm', 'AddNum_Pre', 'Add_Number',
  'AddNum_Suf', 'St_PreDir', 'St_PreTyp', 'St_Name', 'St_PosTyp', 'St_PosDir',
  'ESN', 'MSAGComm', 'Post_Comm', 'Post_Code', 'Post_Code4', 'Building',
  'Floor', 'Unit', 'Room', 'Seat', 'Addtl_Loc', 'LandmkName', 'Place_Type',
  'Placement', 'Long', 'Lat', 'Elev',
];

const CENTERLINE_COLUMNS = [
  'St_PreDir', 'St_Name', 'St_PosTyp', 'St_PosDir',
  'FromAddr_L', 'ToAddr_L', 'Parity_L',
  'FromAddr_R', 'ToAddr_R', 'Parity_R', 'Method',
];

function rangeAndParity(nums: number[]): {
  from: number | '';
  to: number | '';
  parity: string;
} {
  if (nums.length === 0) return { from: '', to: '', parity: '' };
  const evens = nums.filter((n) => n % 2 === 0);
  const odds = nums.filter((n) => n % 2 === 1);
  const parity = evens.length >= odds.length ? 'even' : 'odd';
  const dom = parity === 'even' ? evens : odds;
  const pool = dom.length ? dom : nums;
  return { from: Math.min(...pool), to: Math.max(...pool), parity };
}

/** Left/right of a polyline's direction at the nearest segment (metric plane). */
export function sideOfLine(coords: number[][], lon: number, lat: number): 'L' | 'R' {
  const mlon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const mlat = 111_320;
  const px = lon * mlon;
  const py = lat * mlat;
  let best = Infinity;
  let bestCross = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * mlon;
    const ay = coords[i][1] * mlat;
    const bx = coords[i + 1][0] * mlon;
    const by = coords[i + 1][1] * mlat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = (px - cx) ** 2 + (py - cy) ** 2;
    if (d < best) {
      best = d;
      bestCross = dx * (py - ay) - dy * (px - ax);
    }
  }
  return bestCross > 0 ? 'L' : 'R';
}

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns: string[], rows: SsapRow[]): string {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  return [head, ...body].join('\n');
}
