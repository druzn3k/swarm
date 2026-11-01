//! Bit-exact port of seedrandom 2.4.2 ARC4, as `engine/src/seedrand.ts` uses it.
//!
//! Only string seeds are supported (the TS code always passes a string). The
//! seed in the game is `"{str(date.started)}:{seedstring}"`; for
//! `effecttypes.ts` the seedstring is `[{restarted.getTime()}, {parent.name},
//! {level}]`, where `getTime()` is an integer, so plain integer formatting
//! matches JS `String(number)` and no float-to-string port is needed.

const WIDTH: usize = 256;
const MASK: usize = WIDTH - 1;
const CHUNKS: usize = 6;
const START_DENOM: f64 = 281_474_976_710_656.0; // 256^6
const SIGNIFICANCE: f64 = 4_503_599_627_370_496.0; // 2^52
const OVERFLOW: f64 = SIGNIFICANCE * 2.0; // 2^53

/// A seeded ARC4 random number generator identical to `seedrandom@2.4.2`.
#[derive(Clone, Debug)]
pub struct SeedRandom {
    i: usize,
    j: usize,
    s: [u8; WIDTH],
}

/// Port of `mixkey(flatten(seed), key)` for string seeds: folds the UTF-16
/// code units of the seed into at most 256 key bytes.
fn mixkey(seed: &str) -> Vec<u8> {
    let mut key: Vec<u8> = Vec::new();
    // `smear` starts undefined in JS; `undefined ^ x` is `0 ^ x`, and it persists across chars.
    let mut smear: i32 = 0;
    for (j, unit) in seed.encode_utf16().enumerate() {
        let idx = j & MASK;
        if idx >= key.len() {
            key.push(0);
        }
        smear ^= i32::from(key[idx]) * 19;
        key[idx] = ((smear + i32::from(unit)) & MASK as i32) as u8;
    }
    key
}

impl SeedRandom {
    /// Seeds the generator exactly like `new seedrandom(seed)`, including the
    /// key schedule and the initial discarding of 256 bytes.
    pub fn new(seed: &str) -> Self {
        let mut key = mixkey(seed);
        if key.is_empty() {
            key.push(0);
        }
        let mut s = [0u8; WIDTH];
        for (i, v) in s.iter_mut().enumerate() {
            *v = i as u8;
        }
        let mut j = 0usize;
        for i in 0..WIDTH {
            let t = s[i];
            j = (j + usize::from(key[i % key.len()]) + usize::from(t)) & MASK;
            s[i] = s[j];
            s[j] = t;
        }
        let mut rng = SeedRandom { i: 0, j: 0, s };
        rng.g(WIDTH);
        rng
    }

    /// ARC4 `g(count)`: returns `count` bytes combined big-endian as a double.
    fn g(&mut self, count: usize) -> f64 {
        let mut r = 0.0f64;
        for _ in 0..count {
            self.i = (self.i + 1) & MASK;
            let t = self.s[self.i];
            self.j = (self.j + usize::from(t)) & MASK;
            self.s[self.i] = self.s[self.j];
            self.s[self.j] = t;
            let idx = (usize::from(self.s[self.i]) + usize::from(t)) & MASK;
            r = r * WIDTH as f64 + f64::from(self.s[idx]);
        }
        r
    }

    /// The `prng()` of seedrandom: a double in `[0, 1)` with 53 significant bits.
    pub fn next_f64(&mut self) -> f64 {
        let mut n = self.g(CHUNKS);
        let mut d = START_DENOM;
        let mut x = 0.0f64;
        while n < SIGNIFICANCE {
            n = (n + x) * WIDTH as f64;
            d *= WIDTH as f64;
            x = self.g(1);
        }
        while n >= OVERFLOW {
            n /= 2.0;
            d /= 2.0;
            x = f64::from((x as u32) >> 1);
        }
        (n + x) / d
    }
}

/// Builds `"{base}:{seedstring}"` like `SeedRand.mkseed`, where `base` is the
/// already-rendered `str(date.started)` (see [`utc_date_string`]).
pub fn mkseed(base: &str, seedstring: &str) -> String {
    format!("{base}:{seedstring}")
}

/// One-shot random number like `SeedRand.rand`: `new(mkseed(base, s)).next_f64()`.
pub fn rand(base: &str, seedstring: &str) -> f64 {
    SeedRandom::new(&mkseed(base, seedstring)).next_f64()
}

/// Renders an epoch-millisecond timestamp like `utcDateString` in
/// `engine/src/util.ts`, e.g. `Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)`.
pub fn utc_date_string(epoch_ms: i64) -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let secs = epoch_ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let weekday = (days + 4).rem_euclid(7) as usize;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let mut y = yoe + era * 400;
    if month <= 2 {
        y += 1;
    }
    let year = if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("{y:04}")
    };
    format!(
        "{} {} {:02} {} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
        DAYS[weekday],
        MONTHS[(month - 1) as usize],
        day,
        year,
        sod / 3600,
        sod / 60 % 60,
        sod % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTORS: &[(&str, [f64; 10])] = &[
    ("",
     [0.23144008215179881, 0.27404636548159655, 0.7901279251811976, 0.40384160557189036, 0.1321140086237582, 0.6182831712505996, 0.9154111225454327, 0.1502617438764764, 0.9706087980957805, 0.4651304822486096]),
    ("a",
     [0.43449421599986604, 0.5451403460013228, 0.3578386258898537, 0.5680674010372789, 0.5891631034580515, 0.6363726288676872, 0.005222270723581011, 0.33566655610801654, 0.8443067926032052, 0.18074943459681073]),
    ("x",
     [0.9080614664401105, 0.7435925582582555, 0.7446637697076844, 0.3991726371354845, 0.1792922165091173, 0.9483559326966985, 0.9935340928937593, 0.5217370165815608, 0.0033965539911560553, 0.10759894382196845]),
    ("hello",
     [0.5463663768140734, 0.4397379377059223, 0.554769432473455, 0.7627046759719986, 0.4805307030523447, 0.9729326172968012, 0.92403798206558, 0.6684094552225839, 0.9782811118900929, 0.4846980885530663]),
    ("Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time):x",
     [0.523130866595774, 0.13429238740394944, 0.3787254460450602, 0.05034876905157192, 0.34825617737536035, 0.23446604479755995, 0.26865304071854035, 0.3167462853406678, 0.2832794180333403, 0.2471279032560563]),
    ("Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time):y",
     [0.5018915016163997, 0.9861781124779145, 0.8786626022592805, 0.768455478430829, 0.3581135140275175, 0.28357501746135505, 0.4725043672472537, 0.0888259154583955, 0.42442545851402147, 0.9082881143906133]),
    ("Tue Dec 13 2022 23:43:51 GMT+0000 (Coordinated Universal Time):[1670975031893, Hatchery, 1]",
     [0.570357292438141, 0.4524266791759058, 0.3561799882892885, 0.4969244276270188, 0.5387276337029746, 0.33333010382037004, 0.8035727816623005, 0.3531778951982852, 0.08423667819909521, 0.6880704632767791]),
    ("Tue Dec 13 2022 23:43:51 GMT+0000 (Coordinated Universal Time):[1670975031893, Expansion, 12]",
     [0.04491865772303816, 0.937995517774171, 0.20789405903195812, 0.5940236081721342, 0.1593977584940263, 0.41744691835089964, 0.9501395274630817, 0.2562244943125604, 0.3644355356900694, 0.22653084726341366]),
    ("Sat Feb 29 2020 12:00:00 GMT+0000 (Coordinated Universal Time):[1582977600000, Nest, 0]",
     [0.5921517319671851, 0.827841067334506, 0.5812192539044148, 0.933954498244363, 0.2829103147253716, 0.2577081312215574, 0.22135768203995848, 0.12784141948878375, 0.9322986615249439, 0.034568148762072363]),
    ("0",
     [0.7803563384230067, 0.05144520047760746, 0.5317574394273067, 0.4885194745974366, 0.8764000274360477, 0.7467466967539371, 0.7317929172654256, 0.054310377919145406, 0.7148596772003355, 0.5458888111266181]),
    ("1",
     [0.2694488477791326, 0.43440878183925163, 0.8740779300873869, 0.24815964810523447, 0.5475022964720837, 0.5186533177082818, 0.7480239601540962, 0.20990611638182496, 0.42479142849134716, 0.004679970567159685]),
    ("12345",
     [0.20703519639616447, 0.6602710883040208, 0.500949276170095, 0.8740238761320421, 0.9903526683414697, 0.7428471144268892, 0.9628455843080531, 0.9273574499421892, 0.11057175976077178, 0.7751403762604759]),
    ("\u{e9}\u{fc}",
     [0.9659065255724234, 0.3369102703166289, 0.14193997448412413, 0.6656734248445727, 0.1805868703021515, 0.005997378943380971, 0.8736016450066799, 0.8609081368708251, 0.10200484007797071, 0.016881902505712754]),
    ("caf\u{e9} \u{2603}",
     [0.919255469595987, 0.26234801693109655, 0.5461549314071226, 0.6991559325856677, 0.774735315129369, 0.6817034236709598, 0.7428481508486169, 0.3414542695229015, 0.6282802369599312, 0.04349224875477348]),
    ("\u{1f600} emoji",
     [0.9378158651808273, 0.6069773959691506, 0.9503516635319784, 0.497099405052264, 0.3785371214761097, 0.6800686348443297, 0.06620462606766382, 0.022425562514101497, 0.17546133257314023, 0.5681386296826991]),
    ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
     [0.7896636759683583, 0.46838180524185613, 0.23467569070185423, 0.16372236556346192, 0.07711726641093321, 0.4738620243517629, 0.306537471157538, 0.8333775101302876, 0.6632948871851378, 0.07709100077301036]),
    ("abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij",
     [0.5600600764192039, 0.19293915954150434, 0.22709150397848415, 0.8725856590811638, 0.6246933639632083, 0.81136554968362, 0.7648465811632341, 0.8241076841922158, 0.6619691979035476, 0.536431970219109]),
    ("\u{100}\u{101}",
     [0.7123457008542663, 0.5400085228517185, 0.6493862692546217, 0.4928911322502078, 0.735949031324763, 0.058221915692288635, 0.8677643749550692, 0.07948699221235184, 0.5961113816672313, 0.5003088415496264]),
    ("seed with spaces",
     [0.8248610666071478, 0.18537588957101941, 0.3567069260940092, 0.39674240817667844, 0.8362824236058608, 0.7337088867464528, 0.5269978796033148, 0.4997819837895623, 0.10479758976114553, 0.03884981115200808]),
    ("x:y:z",
     [0.38018214758419117, 0.022285386769080196, 0.8379644449648251, 0.6564734434346832, 0.771454113710878, 0.42047723243313495, 0.020508813737348093, 0.6324577193429811, 0.8813557887339996, 0.5540683510401959]),
    ("[0, Queen, 5]",
     [0.8114714856063152, 0.2462322616817953, 0.5376344414121995, 0.9893488459712947, 0.20099419143414776, 0.028067977650873148, 0.6812659421109637, 0.20101727608683312, 0.14218339815344977, 0.8830878661927033]),
    ("Fri Jan 01 1971 00:00:00 GMT+0000 (Coordinated Universal Time):[0, Drone, 100]",
     [0.08707748639813302, 0.5730523296786078, 0.1774903977579538, 0.4775746232978422, 0.51809610579417, 0.7270462218996507, 0.6428201815523104, 0.815675972402182, 0.42162514068014206, 0.9688839821422477]),

    ];

    const DATES: &[(i64, &str)] = &[
        (
            0,
            "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            1670975031893,
            "Tue Dec 13 2022 23:43:51 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            1582977600000,
            "Sat Feb 29 2020 12:00:00 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            -1,
            "Wed Dec 31 1969 23:59:59 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            -63072000000000,
            "Sat May 01 -000029 00:00:00 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            951782400000,
            "Tue Feb 29 2000 00:00:00 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            4102444799999,
            "Thu Dec 31 2099 23:59:59 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            253402300799999,
            "Fri Dec 31 9999 23:59:59 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            -62198755200000,
            "Fri Jan 01 -000001 00:00:00 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            1000,
            "Thu Jan 01 1970 00:00:01 GMT+0000 (Coordinated Universal Time)",
        ),
        (
            -62135596800000,
            "Mon Jan 01 0001 00:00:00 GMT+0000 (Coordinated Universal Time)",
        ),
    ];

    #[test]
    fn matches_seedrandom_js() {
        for (seed, expected) in VECTORS {
            let mut rng = SeedRandom::new(seed);
            for (k, want) in expected.iter().enumerate() {
                assert_eq!(
                    rng.next_f64().to_bits(),
                    want.to_bits(),
                    "seed {seed:?} draw {k}"
                );
            }
        }
    }

    #[test]
    fn utc_date_string_matches_node() {
        for (ms, want) in DATES {
            assert_eq!(utc_date_string(*ms), *want, "ms {ms}");
        }
    }

    // Ports of engine/test/seedrand.test.ts.
    #[test]
    fn generates_deterministic_random_numbers() {
        // TS: rand(seedstring, baseseed) with arbitrary string bases.
        assert_ne!(rand("y", "x"), rand("z", "x"));
        assert_ne!(rand("y", "x"), rand("y", "w"));
        assert_ne!(rand("y", "x"), rand("x", "y"));
        assert_eq!(rand("y", "x"), rand("y", "x"));
    }

    #[test]
    fn defaults_base_seed_to_date_started() {
        let base = utc_date_string(0);
        assert_eq!(
            mkseed(&base, "x"),
            "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time):x"
        );
        assert_eq!(rand(&base, "x"), rand(&utc_date_string(0), "x"));
        assert_ne!(rand(&base, "x"), rand(&utc_date_string(1000), "x"));
    }
}
