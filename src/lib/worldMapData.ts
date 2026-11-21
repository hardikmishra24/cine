import type { MapRegionId } from '../types/cineforge';

export interface MapLandmass {
  name: string;
  /** Polygon vertices in normalized 0..100 viewport coordinates */
  points: Array<[number, number]>;
}

export interface MapRegionDefinition {
  id: MapRegionId;
  label: string;
  graticuleSpacing: number;
  landmasses: MapLandmass[];
  defaultLabels: Array<{ text: string; x: number; y: number }>;
}

export const MAP_REGIONS: Record<MapRegionId, MapRegionDefinition> = {
  world: {
    id: 'world',
    label: 'World Atlas',
    graticuleSpacing: 12,
    landmasses: [
      {
        name: 'North America',
        points: [
          [7, 20], [16, 15], [27, 17], [33, 24], [30, 34], [25, 42],
          [22, 48], [18, 49], [16, 43], [11, 35], [8, 28],
        ],
      },
      {
        name: 'Greenland',
        points: [[33, 10], [41, 9], [43, 18], [37, 22], [32, 16]],
      },
      {
        name: 'South America',
        points: [
          [23, 52], [30, 52], [36, 61], [33, 74], [28, 86], [24, 84],
          [24, 71], [21, 60],
        ],
      },
      {
        name: 'Europe',
        points: [
          [44, 29], [47, 21], [54, 17], [60, 20], [59, 30], [54, 34],
          [49, 35], [45, 34],
        ],
      },
      {
        name: 'Africa',
        points: [
          [44, 39], [52, 37], [60, 41], [63, 52], [58, 69], [53, 77],
          [48, 72], [46, 57], [42, 49],
        ],
      },
      {
        name: 'Asia',
        points: [
          [60, 18], [75, 16], [89, 21], [91, 33], [84, 46], [77, 50],
          [71, 46], [66, 48], [60, 40], [59, 30],
        ],
      },
      {
        name: 'Australia',
        points: [
          [77, 63], [86, 61], [92, 69], [90, 79], [81, 80], [75, 74],
        ],
      },
    ],
    defaultLabels: [
      { text: 'ATLANTIC', x: 38, y: 46 },
      { text: 'PACIFIC', x: 11, y: 62 },
      { text: 'INDIAN OCEAN', x: 69, y: 66 },
    ],
  },
  north_america: {
    id: 'north_america',
    label: 'North America & Mexico',
    graticuleSpacing: 14,
    landmasses: [
      {
        name: 'Continental North America',
        points: [
          [6, 10], [28, 8], [56, 10], [78, 16], [86, 26], [80, 38],
          [71, 46], [64, 52], [60, 58], [52, 56], [47, 63], [52, 74],
          [62, 82], [58, 90], [45, 86], [35, 74], [28, 61], [22, 54],
          [16, 44], [12, 32], [8, 22],
        ],
      },
      {
        name: 'Baja Peninsula',
        points: [[20, 53], [24, 57], [28, 68], [25, 70], [19, 59]],
      },
      {
        name: 'Cuba & Caribbean',
        points: [[65, 65], [76, 66], [78, 70], [67, 70]],
      },
    ],
    defaultLabels: [
      { text: 'UNITED STATES', x: 46, y: 36 },
      { text: 'MEXICO', x: 41, y: 69 },
      { text: 'GULF OF MEXICO', x: 60, y: 64 },
      { text: 'PACIFIC OCEAN', x: 14, y: 74 },
    ],
  },
  europe: {
    id: 'europe',
    label: 'Europe & Mediterranean',
    graticuleSpacing: 14,
    landmasses: [
      {
        name: 'Mainland Europe',
        points: [
          [14, 60], [16, 46], [26, 42], [34, 34], [46, 30], [56, 20],
          [76, 14], [92, 16], [94, 54], [80, 62], [69, 58], [62, 68],
          [56, 64], [52, 72], [46, 62], [38, 60], [32, 66], [20, 70],
          [14, 67],
        ],
      },
      {
        name: 'Britain & Ireland',
        points: [[22, 27], [30, 26], [32, 41], [23, 42], [20, 35]],
      },
      {
        name: 'Scandinavia',
        points: [[44, 12], [58, 8], [62, 22], [52, 27], [43, 24]],
      },
      {
        name: 'North Africa Coast',
        points: [[10, 82], [36, 78], [62, 82], [88, 80], [94, 96], [10, 96]],
      },
    ],
    defaultLabels: [
      { text: 'ATLANTIC', x: 10, y: 38 },
      { text: 'NORTH SEA', x: 37, y: 26 },
      { text: 'MEDITERRANEAN SEA', x: 46, y: 76 },
    ],
  },
  australia: {
    id: 'australia',
    label: 'Australia & Outback',
    graticuleSpacing: 15,
    landmasses: [
      {
        name: 'Mainland Australia',
        points: [
          [22, 34], [32, 22], [44, 18], [52, 23], [60, 14], [69, 17],
          [78, 30], [84, 48], [80, 66], [70, 76], [58, 72], [48, 66],
          [34, 68], [21, 64], [17, 50],
        ],
      },
      {
        name: 'Tasmania',
        points: [[68, 82], [75, 82], [73, 90], [67, 89]],
      },
      {
        name: 'New Guinea (South)',
        points: [[54, 4], [82, 6], [88, 12], [62, 11]],
      },
    ],
    defaultLabels: [
      { text: 'WESTERN AUSTRALIA', x: 31, y: 48 },
      { text: 'OUTBACK', x: 52, y: 45 },
      { text: 'INDIAN OCEAN', x: 10, y: 72 },
      { text: 'CORAL SEA', x: 86, y: 26 },
    ],
  },
  asia: {
    id: 'asia',
    label: 'East & South Asia',
    graticuleSpacing: 14,
    landmasses: [
      {
        name: 'Asian Mainland',
        points: [
          [8, 14], [48, 10], [82, 16], [84, 34], [76, 52], [68, 64],
          [60, 74], [54, 66], [46, 58], [38, 74], [30, 62], [24, 52],
          [12, 46], [8, 30],
        ],
      },
      {
        name: 'Japan Archipelago',
        points: [[84, 34], [91, 30], [92, 44], [85, 48], [82, 42]],
      },
      {
        name: 'Maritime Southeast Asia',
        points: [[62, 78], [78, 76], [86, 84], [70, 88]],
      },
    ],
    defaultLabels: [
      { text: 'HIMALAYAS', x: 38, y: 44 },
      { text: 'PACIFIC', x: 90, y: 62 },
      { text: 'INDIAN OCEAN', x: 24, y: 82 },
    ],
  },
  middle_east: {
    id: 'middle_east',
    label: 'Middle East & Levant',
    graticuleSpacing: 14,
    landmasses: [
      {
        name: 'Anatolia & Persia',
        points: [
          [12, 12], [44, 14], [74, 12], [92, 20], [92, 54], [72, 58],
          [56, 46], [42, 42], [28, 38], [12, 34],
        ],
      },
      {
        name: 'Arabian Peninsula',
        points: [
          [34, 42], [54, 44], [74, 64], [64, 84], [44, 86], [34, 68],
          [28, 52],
        ],
      },
      {
        name: 'Egypt & Nile',
        points: [[8, 42], [26, 44], [32, 66], [36, 86], [8, 88]],
      },
    ],
    defaultLabels: [
      { text: 'MEDITERRANEAN', x: 16, y: 38 },
      { text: 'RED SEA', x: 31, y: 68 },
      { text: 'PERSIAN GULF', x: 64, y: 53 },
    ],
  },
  south_america: {
    id: 'south_america',
    label: 'South America',
    graticuleSpacing: 14,
    landmasses: [
      {
        name: 'South America',
        points: [
          [30, 10], [48, 12], [68, 22], [78, 36], [70, 56], [56, 74],
          [46, 90], [38, 86], [34, 68], [26, 48], [22, 28],
        ],
      },
    ],
    defaultLabels: [
      { text: 'ANDES', x: 30, y: 50 },
      { text: 'AMAZON BASIN', x: 48, y: 32 },
      { text: 'ATLANTIC', x: 80, y: 66 },
      { text: 'PACIFIC', x: 14, y: 62 },
    ],
  },
  pacific: {
    id: 'pacific',
    label: 'Pacific Theater',
    graticuleSpacing: 14,
    landmasses: [
      {
        name: 'East Asia Rim',
        points: [[4, 12], [22, 16], [24, 38], [16, 56], [6, 62]],
      },
      {
        name: 'Australia',
        points: [[12, 70], [32, 68], [36, 86], [16, 88]],
      },
      {
        name: 'Americas Rim',
        points: [[78, 10], [96, 12], [96, 88], [84, 72], [76, 44]],
      },
      {
        name: 'Central Pacific Islands',
        points: [[48, 42], [53, 43], [52, 47], [47, 46]],
      },
    ],
    defaultLabels: [
      { text: 'PACIFIC OCEAN', x: 50, y: 56 },
      { text: 'MIDWAY / HAWAII', x: 52, y: 38 },
    ],
  },
  atlantic: {
    id: 'atlantic',
    label: 'Atlantic Crossing',
    graticuleSpacing: 14,
    landmasses: [
      {
        name: 'Americas East Coast',
        points: [[4, 10], [26, 14], [24, 36], [18, 52], [30, 68], [22, 90], [4, 90]],
      },
      {
        name: 'Europe & Africa West Coast',
        points: [[72, 12], [96, 12], [96, 90], [78, 86], [70, 64], [74, 42], [68, 28]],
      },
    ],
    defaultLabels: [
      { text: 'NORTH ATLANTIC', x: 48, y: 34 },
      { text: 'SOUTH ATLANTIC', x: 50, y: 72 },
    ],
  },
};

export function detectMapRegionFromText(text: string): MapRegionId {
  const lower = text.toLowerCase();
  if (/(mexico|mexican|texas|alamo|united states|america|california|washington|canada|new york|veracruz|rio grande)/.test(lower)) {
    return 'north_america';
  }
  if (/(australia|emu|perth|campion|outback|sydney|melbourne|canberra)/.test(lower)) {
    return 'australia';
  }
  if (/(europe|france|paris|louvre|britain|england|london|germany|rome|italy|spain|portugal|netherlands|dutch|scilly|mediterranean|sicily|berlin|napoleon|waterloo)/.test(lower)) {
    return 'europe';
  }
  if (/(egypt|persia|iran|iraq|baghdad|ottoman|istanbul|constantinople|arabia|jerusalem|levant|mesopotamia|syria)/.test(lower)) {
    return 'middle_east';
  }
  if (/(china|japan|india|mongol|silk road|tokyo|beijing|delhi|korea|vietnam|asia|himalaya)/.test(lower)) {
    return 'asia';
  }
  if (/(brazil|argentina|peru|inca|andes|amazon|bolivia|chile|colombia|south america)/.test(lower)) {
    return 'south_america';
  }
  if (/(pacific|hawaii|pearl harbor|midway|guadalcanal|voyager|polynesia)/.test(lower)) {
    return 'pacific';
  }
  if (/(atlantic|titanic|transatlantic|columbus|azores)/.test(lower)) {
    return 'atlantic';
  }
  return 'world';
}
