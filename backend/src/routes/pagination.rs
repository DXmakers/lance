use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct PaginationQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PaginationBounds {
    pub limit: i64,
    pub offset: i64,
}

impl PaginationQuery {
    const DEFAULT_LIMIT: u32 = 25;
    const MAX_LIMIT: u32 = 100;

    pub fn bounds(self) -> PaginationBounds {
        let limit = self
            .limit
            .unwrap_or(Self::DEFAULT_LIMIT)
            .clamp(1, Self::MAX_LIMIT) as i64;
        let offset = self.offset.unwrap_or(0) as i64;

        PaginationBounds { limit, offset }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_apply_defaults() {
        let bounds = PaginationQuery {
            limit: None,
            offset: None,
        }
        .bounds();

        assert_eq!(bounds.limit, 25);
        assert_eq!(bounds.offset, 0);
    }

    #[test]
    fn bounds_clamp_limit_to_maximum() {
        let bounds = PaginationQuery {
            limit: Some(1_000),
            offset: Some(42),
        }
        .bounds();

        assert_eq!(bounds.limit, 100);
        assert_eq!(bounds.offset, 42);
    }
}
