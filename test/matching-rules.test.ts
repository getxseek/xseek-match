import { describe, expect, it } from 'vitest';
import { groupResults, type Result } from '../src/domain/matching/group.js';

// Grouping cases for the release matching rules. Every name is made up.
const row = (indexerId: number, title: string, size = 1000): Result => ({
  guid: `${indexerId}:${title}`,
  indexerId,
  indexer: `Tracker ${indexerId}`,
  title,
  size,
});

function grouped(left: string, right: string): boolean {
  return groupResults([row(1, left), row(2, right)]).length === 1;
}

describe('anime batch spans are packs, not their first episode', () => {
  const span = '[Hoshi-Subs] Tidepool Academy - 01 ~ 28 [1080p]';
  it('keeps a span apart from episode 1, even without sizes', () => {
    expect(
      groupResults([
        { ...row(1, span), size: 0 },
        { ...row(2, '[Hoshi-Subs] Tidepool Academy - 01 [1080p]'), size: 0 },
      ]),
    ).toHaveLength(2);
  });
  it('groups the same span written with ~ or -', () => {
    expect(grouped(span, '[Hoshi-Subs] Tidepool Academy - 01-28 [1080p]')).toBe(true);
  });
  it('keeps different spans apart', () => {
    expect(grouped(span, '[Hoshi-Subs] Tidepool Academy - 01 ~ 12 [1080p]')).toBe(false);
  });
});

describe('absolute episodes compare as numbers', () => {
  it('groups - 5 with - 05', () => {
    expect(
      grouped(
        '[Hoshi-Subs] Tidepool Academy - 5 [1080p]',
        '[Hoshi-Subs] Tidepool Academy - 05 [1080p]',
      ),
    ).toBe(true);
  });
});

const larkspur = (tags: string) => `Larkspur.Lane.2019.2160p.${tags}-BRISK`;

describe('plain HDR pairs with HDR10', () => {
  const pair = (left: string, right: string) => grouped(larkspur(left), larkspur(right));
  it('groups HDR with HDR10', () => {
    expect(pair('WEB-DL.HDR.H265', 'WEB-DL.HDR10.H265')).toBe(true);
  });
  it('groups DV.HDR with DoVi.HDR10', () => {
    expect(pair('UHD.BluRay.DV.HDR.x265', 'UHD.BluRay.DoVi.HDR10.x265')).toBe(true);
  });
  it('keeps HDR apart from HDR10+, HLG and DV.HDR10', () => {
    expect(pair('WEB-DL.HDR.H265', 'WEB-DL.HDR10+.H265')).toBe(false);
    expect(pair('WEB-DL.HDR.H265', 'WEB-DL.HLG.H265')).toBe(false);
    expect(pair('WEB-DL.HDR.H265', 'WEB-DL.DV.HDR10.H265')).toBe(false);
  });
  // Trackers drop the + under Dolby Vision: one writes `DV HDR10+` where another writes `DV.HDR` for the same file.
  it('groups DV.HDR10+ with DV.HDR but keeps HLG apart from SDR', () => {
    expect(pair('WEB-DL.DV.HDR10+.H265', 'WEB-DL.DV.HDR.H265')).toBe(true);
    expect(pair('WEB-DL.DV.HDR10+.H265', 'WEB-DL.HDR10+.H265')).toBe(false);
    expect(pair('WEB-DL.HLG.H265', 'WEB-DL.H265')).toBe(false);
  });
});

describe('Ma10 is a tag, and seasonless bracketed batches get a key', () => {
  it('groups the same bracketed batch listed on two trackers', () => {
    const batch = '[Hoshi-Subs] Tidepool Academy (BD 1080p Ma10 FLAC) [Batch]';
    expect(grouped(batch, batch)).toBe(true);
  });
  it('keeps Ma10 out of the group and the title', () => {
    expect(
      grouped(
        'Tidepool.Academy.Ma10.S01.1080p.BluRay.FLAC-Hoshi',
        'Tidepool.Academy.S01.1080p.BluRay.FLAC-Hoshi',
      ),
    ).toBe(true);
    const untagged = 'Tidepool.Academy.S01.1080p.BluRay.FLAC.x265-Ma10';
    expect(grouped(untagged, untagged)).toBe(false);
  });
});

describe('[Hoshi-Subs] at the start pairs with -Hoshi-Subs at the end', () => {
  const bracket = '[Hoshi-Subs] Tidepool Academy S02E07 [1080p]';
  const suffix = (group: string) => `Tidepool Academy S02E07 1080p WEB-DL AAC2.0 x265-${group}`;
  it('groups the leading bracket with the exact dash suffix, in either order', () => {
    expect(grouped(bracket, suffix('Hoshi-Subs'))).toBe(true);
    expect(grouped(suffix('Hoshi-Subs'), bracket)).toBe(true);
  });
  it('keeps a partial, longer or other suffix apart', () => {
    expect(grouped(bracket, suffix('Subs'))).toBe(false);
    expect(grouped(bracket, suffix('Big-Hoshi-Subs'))).toBe(false);
    expect(grouped(bracket, suffix('Other'))).toBe(false);
  });
  it('keeps a -Subs suffix out of a bracket group the -Hoshi-Subs form joined', () => {
    // -Hoshi-Subs and -Subs share group subs; only -Hoshi-Subs may join the bracket.
    const groups = groupResults([
      row(1, bracket),
      row(2, suffix('Hoshi-Subs')),
      row(3, suffix('Subs')),
    ]);
    expect(groups.map((group) => group.rows.length).sort()).toEqual([1, 2]);
  });
});

describe('- Wren) [Lattice] pairs with - Wren Lattice)', () => {
  const ferrous = (tail: string) =>
    `Ferrous Bloom (2021) (1080p NF WEB-DL x265 10bit DDP 5.1 - ${tail}`;
  const bracketed = ferrous('Wren) [Lattice]');
  const joined = ferrous('Wren Lattice)');
  it('groups group + collective with the space-joined group, in either order', () => {
    expect(grouped(bracketed, joined)).toBe(true);
    expect(grouped(joined, bracketed)).toBe(true);
  });
  it('keeps another second word, a bare group and the reversed order apart', () => {
    expect(grouped(bracketed, ferrous('Wren Other)'))).toBe(false);
    expect(grouped(joined, ferrous('Wren)'))).toBe(false);
    expect(grouped(bracketed, ferrous('Lattice Wren)'))).toBe(false);
  });
  it('keeps two different collectives apart', () => {
    expect(grouped(bracketed, ferrous('Wren) [Other]'))).toBe(false);
  });
  it('reads a trailing [REPACK] as a tag, not a collective', () => {
    expect(grouped(ferrous('Wren) [REPACK]'), ferrous('Wren REPACK)'))).toBe(false);
    expect(grouped(ferrous('Wren) [REPACK]'), ferrous('Wren) [Lattice]'))).toBe(false);
  });
});

describe('Roman-numeral season at the end of a title', () => {
  // Grouping needs a resolution, so the batch names carry `(BD 1080p)`.
  const batch = '[Hoshi-Subs] Glass Orchard II (BD 1080p) [Batch]';
  it('groups XI.S11 with S11 and I.S01 with S01', () => {
    expect(
      grouped('Glass.Orchard.XI.S11.1080p.WEB.H264-NOVA', 'Glass.Orchard.S11.1080p.WEB.H264-NOVA'),
    ).toBe(true);
    expect(
      grouped('Glass.Orchard.I.S01.1080p.WEB.H264-NOVA', 'Glass.Orchard.S01.1080p.WEB.H264-NOVA'),
    ).toBe(true);
  });
  it('keeps a numeral that disagrees with the marker apart', () => {
    expect(
      grouped('Glass.Orchard.III.S02.1080p.WEB.H264-NOVA', 'Glass.Orchard.S02.1080p.WEB.H264-NOVA'),
    ).toBe(false);
  });
  it('groups a seasonless batch with its numeral season', () => {
    expect(grouped(batch, 'Glass Orchard S02 1080p BluRay x265-Hoshi-Subs')).toBe(true);
  });
  it('guesses no season for an episode', () => {
    expect(
      grouped(
        '[Hoshi-Subs] Glass Orchard 100 II - 03 (1080p)',
        'Glass Orchard 100 S02E03 1080p WEB H264-Hoshi-Subs',
      ),
    ).toBe(false);
  });
  it('does not read a movie sequel as a season', () => {
    expect(
      grouped(
        'Glass.Orchard.III.1982.1080p.BluRay.x264-NOVA',
        'Glass.Orchard.S03.1080p.BluRay.x264-NOVA',
      ),
    ).toBe(false);
  });
  it('groups a seasonless batch titled with the numeral with that show as season 1', () => {
    expect(grouped(batch, 'Glass Orchard II S01 1080p BluRay x265-Hoshi-Subs')).toBe(true);
    expect(grouped(batch, 'Glass Orchard S03 1080p BluRay x265-Hoshi-Subs')).toBe(false);
  });
});

describe('a stated (Season N) is not a seasonless batch', () => {
  it('keeps a (Season 7) batch apart from season 1', () => {
    expect(
      grouped(
        '[Hoshi-Subs] Tidepool Academy (Season 7) [1080p] (Batch)',
        'Tidepool Academy S01 1080p BluRay x265-Hoshi-Subs',
      ),
    ).toBe(false);
    expect(
      grouped(
        '[Hoshi-Subs] Tidepool Academy (Season 7) [1080p] (Batch)',
        'Tidepool Academy S07 1080p BluRay x265-Hoshi-Subs',
      ),
    ).toBe(true);
  });
});

describe('a title word that reads like a release tag keeps the year', () => {
  it('keeps two years of a title containing Web apart', () => {
    expect(
      grouped('Copper.Web.2019.1080p.BluRay.x264-BRISK', 'Copper.Web.2023.1080p.BluRay.x264-BRISK'),
    ).toBe(false);
  });
  it('groups the same year written with dots and spaces', () => {
    expect(
      grouped('Copper.Web.2019.1080p.BluRay.x264-BRISK', 'Copper Web 2019 1080p BluRay x264-BRISK'),
    ).toBe(true);
  });
  it('keeps two years of a title starting with Dual apart', () => {
    expect(
      grouped(
        'Dual.Harbor.2018.1080p.WEB-DL.H264-BRISK',
        'Dual.Harbor.2022.1080p.WEB-DL.H264-BRISK',
      ),
    ).toBe(false);
  });
});

describe('a re-release keeps the original year', () => {
  it("groups a Director's Cut re-release with the original year", () => {
    expect(
      grouped(
        'Marrow.Lane.1981.2004.Directors.Cut.1080p.BluRay.x264-BRISK',
        'Marrow.Lane.1981.Directors.Cut.1080p.BluRay.x264-BRISK',
      ),
    ).toBe(true);
  });
  it('keeps a title that ends in a year with its release year', () => {
    expect(
      grouped(
        'Station.1999.2021.1080p.BluRay.x264-BRISK',
        'Station.1999.2021.1080p.BluRay.x264-BRISK',
      ),
    ).toBe(true);
    expect(
      grouped('Station.1999.2021.1080p.BluRay.x264-BRISK', 'Station.1999.1080p.BluRay.x264-BRISK'),
    ).toBe(false);
  });
});

describe('Season N followed by a year is part of a movie title', () => {
  it('keeps a Season 3 movie apart from a season 3 pack', () => {
    expect(
      grouped('Hollow.Season.3.2011.1080p.BluRay.x264-BRISK', 'Hollow.S03.1080p.BluRay.x264-BRISK'),
    ).toBe(false);
  });
  it('groups the movie written with dots and spaces', () => {
    expect(
      grouped(
        'Hollow.Season.3.2011.1080p.BluRay.x264-BRISK',
        'Hollow Season 3 2011 1080p BluRay x264-BRISK',
      ),
    ).toBe(true);
  });
  it('still reads Show 2010 Season 8 as a season pack', () => {
    expect(
      grouped(
        'Hollow.2010.Season.8.1080p.BluRay.x264-BRISK',
        'Hollow.2010.S08.1080p.BluRay.x264-BRISK',
      ),
    ).toBe(true);
  });
});

describe('a leading bracket followed by a year is the title', () => {
  it('groups [VOID] 2009 with VOID.2009', () => {
    expect(
      grouped('[VOID] 2009 1080p BluRay x264-BRISK', 'VOID.2009.1080p.BluRay.x264-BRISK'),
    ).toBe(true);
  });
});
