//! Typed indices into [`GameData`](crate::GameData)'s tables.
//!
//! Each id is the position of the record in its table, which is the
//! spreadsheet order, so ids are only meaningful for the `GameData` that
//! issued them. Saves refer to units and upgrades by name, never by id.

macro_rules! id_type {
    ($(#[$doc:meta])* $name:ident($int:ty)) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(pub $int);

        impl $name {
            /// The position in its table.
            #[inline]
            pub const fn index(self) -> usize {
                self.0 as usize
            }

            /// The id at position `index`; panics if it doesn't fit.
            #[inline]
            pub(crate) fn from_index(index: usize) -> Self {
                $name(<$int>::try_from(index).expect(concat!(stringify!($name), " overflow")))
            }
        }
    };
}

id_type!(
    /// A unit type: an index into [`GameData::units`](crate::GameData::units).
    UnitId(u16)
);
id_type!(
    /// An upgrade or ability: an index into
    /// [`GameData::upgrades`](crate::GameData::upgrades).
    UpgradeId(u16)
);
id_type!(
    /// An achievement: an index into
    /// [`GameData::achievements`](crate::GameData::achievements).
    AchievementId(u16)
);
id_type!(
    /// A crystal pack: an index into [`GameData::mtx`](crate::GameData::mtx).
    MtxId(u16)
);
id_type!(
    /// An interned stat name: an index into
    /// [`GameData::stat_names`](crate::GameData::stat_names).
    StatId(u16)
);
id_type!(
    /// An effect of a unit or an upgrade: an index into
    /// [`GameData::effects`](crate::GameData::effects).
    EffectId(u16)
);
id_type!(
    /// A producer path: an index into
    /// [`GameData::producer_paths`](crate::GameData::producer_paths).
    PathId(u32)
);
id_type!(
    /// A listed tab: an index into [`Tabs::list`](crate::Tabs::list).
    TabId(u8)
);
