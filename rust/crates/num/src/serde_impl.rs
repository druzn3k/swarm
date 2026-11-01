//! `serde` support: a [`Num`] serialises as its canonical
//! [`Display`](core::fmt::Display) string and deserialises from a string or
//! any JSON number. This is the save format.

use core::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::Num;

impl Serialize for Num {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

struct NumVisitor;

impl Visitor<'_> for NumVisitor {
    type Value = Num;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a number or a decimal number string")
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Num, E> {
        v.parse().map_err(E::custom)
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Num, E> {
        if v.is_nan() {
            return Err(E::custom("NaN is not a valid number"));
        }
        Ok(Num::from_f64(v))
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Num, E> {
        Ok(Num::from(v))
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Num, E> {
        Ok(Num::from(v))
    }
}

impl<'de> Deserialize<'de> for Num {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Num, D::Error> {
        deserializer.deserialize_any(NumVisitor)
    }
}
