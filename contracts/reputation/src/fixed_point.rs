/// Safe fixed-point arithmetic for reputation calculations
/// All division operations are protected against division by zero

/// Calculate average rating with safe division
/// Returns 0 if review_count is 0 (no division by zero)
pub fn calculate_avg_rating(total_points: i128, review_count: u32) -> i32 {
    if review_count == 0 {
        return 0;
    }
    
    // Safe division: total_points / review_count
    // Returns 0 if division would result in overflow or underflow
    let count = review_count as i128;
    let avg = total_points / count;
    
    // Clamp to valid rating range (0-5 in 1000-scale)
    avg.clamp(0, 5000) as i32
}

/// Safe division for basis point calculations
/// Returns 0 if denominator is 0
pub fn safe_div_bps(numerator: i128, denominator: i128) -> i32 {
    if denominator == 0 {
        return 0;
    }
    
    let result = numerator / denominator;
    result.clamp(0, 10_000) as i32
}

/// Multiply two basis point values with safe division
/// Returns 0 if denominator is 0
pub fn bps_multiply(a: i32, b: i32, scale: i32) -> i32 {
    if scale == 0 {
        return 0;
    }
    
    let product = (a as i128) * (b as i128);
    let result = product / (scale as i128);
    
    result.clamp(0, 10_000) as i32
}
