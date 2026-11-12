//! Display throughput pairs real output usage with the model interval that produced it.
//! Sparse usage batches never create a clock interval by themselves.

use serde::Serialize;
use std::time::Instant;

const MIN_SAMPLE_MS: u64 = 1_000;
const INITIAL_BURST_MS: u64 = 300;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Most recent complete, measurable request; a sparse batch is not an instantaneous rate.
    pub rate: Option<f64>,
    pub average: Option<f64>,
    pub peak: Option<f64>,
    pub generation_ms: u64,
    pub measured_tokens: f64,
    pub streaming: bool,
}

#[derive(Default)]
struct StreamWeight {
    total: f64,
    backlog: f64,
}

impl StreamWeight {
    fn measured_share(&self) -> f64 {
        if self.total > 0.0 {
            (self.total - self.backlog) / self.total
        } else {
            0.0
        }
    }
}

pub struct Meter {
    clock: Instant,
    open_at: Option<u64>,
    request_ms: u64,
    reported_tokens: u64,
    measured_tokens: f64,
    measured_ms: u64,
    first_delta_at: Option<u64>,
    visible: StreamWeight,
    thinking: StreamWeight,
    tool_streamed: bool,
    reasoning_tokens: Option<u64>,
    rate: Option<f64>,
    peak: Option<f64>,
}

impl Default for Meter {
    fn default() -> Self {
        Self {
            clock: Instant::now(),
            open_at: None,
            request_ms: 0,
            reported_tokens: 0,
            measured_tokens: 0.0,
            measured_ms: 0,
            first_delta_at: None,
            visible: StreamWeight::default(),
            thinking: StreamWeight::default(),
            tool_streamed: false,
            reasoning_tokens: None,
            rate: None,
            peak: None,
        }
    }
}

impl Meter {
    pub fn now(&self) -> u64 {
        self.clock.elapsed().as_millis() as u64
    }

    pub fn begin_request(&mut self, now: u64) -> Option<Snapshot> {
        let was_streaming = self.open_at.is_some();
        self.pause(now);
        self.clear_request();
        was_streaming.then(|| self.snapshot())
    }

    /// The first streamed block starts the clock. Repeated deltas keep the same interval open.
    pub fn start(&mut self, now: u64) -> Option<Snapshot> {
        if self.open_at.is_some() {
            return None;
        }
        self.open_at = Some(now);
        Some(self.snapshot())
    }

    /// Stream length only apportions the request's real usage; it never becomes a token total.
    pub fn delta(&mut self, text: &str, now: u64) -> Option<Snapshot> {
        self.record_delta(text, now, false)
    }

    pub fn thinking_delta(&mut self, text: &str, now: u64) -> Option<Snapshot> {
        self.record_delta(text, now, true)
    }

    fn record_delta(&mut self, text: &str, now: u64, thinking: bool) -> Option<Snapshot> {
        if text.is_empty() {
            return None;
        }
        let phase = self.start(now);
        let first = *self.first_delta_at.get_or_insert(now);
        let weight = text.chars().count() as f64;
        let stream = if thinking {
            &mut self.thinking
        } else {
            &mut self.visible
        };
        stream.total += weight;
        if now.saturating_sub(first) <= INITIAL_BURST_MS {
            stream.backlog += weight;
        }
        phase
    }

    pub fn reasoning_output(&mut self, tokens: Option<u64>) {
        self.reasoning_tokens = tokens;
    }

    pub fn tool_delta(&mut self, text: &str, now: u64) -> Option<Snapshot> {
        self.tool_streamed |= !text.is_empty();
        self.delta(text, now)
    }

    /// Tool arguments delivered whole have no stream timing. Their share stays outside the rate.
    pub fn unstreamed_tool(&mut self, input: &str) {
        if self.tool_streamed || self.visible.total + self.thinking.total <= 0.0 {
            return;
        }
        let weight = input.chars().count() as f64;
        self.visible.total += weight;
        self.visible.backlog += weight;
    }

    /// Tool execution, user confirmation and response completion stop model time.
    pub fn pause(&mut self, now: u64) -> Option<Snapshot> {
        let opened = self.open_at.take()?;
        self.request_ms += now.saturating_sub(opened);
        Some(self.snapshot())
    }

    pub fn settle(&mut self, output_tokens: u64, now: u64) -> Snapshot {
        self.pause(now);
        let tokens = output_tokens.saturating_sub(self.reported_tokens);
        self.reported_tokens = output_tokens;
        if tokens == 0 {
            return self.snapshot();
        }
        let paced_tokens = match self.reasoning_tokens {
            Some(reasoning) => {
                let reasoning = reasoning.min(tokens);
                (tokens - reasoning) as f64 * self.visible.measured_share()
                    + reasoning as f64 * self.thinking.measured_share()
            }
            None => {
                let combined = StreamWeight {
                    total: self.visible.total + self.thinking.total,
                    backlog: self.visible.backlog + self.thinking.backlog,
                };
                tokens as f64 * combined.measured_share()
            }
        };
        if paced_tokens >= 5.0 && self.request_ms >= MIN_SAMPLE_MS {
            let rate = paced_tokens * 1_000.0 / self.request_ms as f64;
            self.measured_tokens += paced_tokens;
            self.measured_ms += self.request_ms;
            self.rate = Some(rate);
            self.peak = Some(self.peak.unwrap_or(rate).max(rate));
        }
        self.clear_request();
        self.snapshot()
    }

    fn clear_request(&mut self) {
        self.request_ms = 0;
        self.first_delta_at = None;
        self.visible = StreamWeight::default();
        self.thinking = StreamWeight::default();
        self.tool_streamed = false;
        self.reasoning_tokens = None;
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            rate: self.rate,
            average: (self.measured_ms > 0)
                .then(|| self.measured_tokens * 1_000.0 / self.measured_ms as f64),
            peak: self.peak,
            generation_ms: self.measured_ms,
            measured_tokens: self.measured_tokens,
            streaming: self.open_at.is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The first character is backlog; the following 100 share the real usage over model time.
    fn stream(meter: &mut Meter, start: u64) {
        meter.delta("x", start);
        meter.delta(&"x".repeat(100), start + 1_000);
    }

    #[test]
    fn long_gaps_between_streamed_tokens_still_count_as_generation() {
        let mut meter = Meter::default();
        stream(&mut meter, 10_000);
        assert!(meter.start(40_000).is_none());
        let speed = meter.settle(2_020, 50_000);
        assert_eq!(speed.rate, Some(50.0));
        assert_eq!(speed.average, Some(50.0));
        assert_eq!(speed.generation_ms, 40_000);
    }

    #[test]
    fn first_byte_latency_and_tool_execution_are_outside_the_clock() {
        let mut meter = Meter::default();
        stream(&mut meter, 20_000);
        meter.pause(22_000);
        let first = meter.settle(101, 80_000);
        assert_eq!(first.rate, Some(50.0));
        stream(&mut meter, 120_000);
        let next = meter.settle(303, 122_000);
        assert_eq!(next.rate, Some(100.0));
        assert_eq!(next.average, Some(75.0));
        assert_eq!(next.peak, Some(100.0));
        assert_eq!(next.generation_ms, 4_000);
    }

    #[test]
    fn a_usage_batch_without_its_stream_has_no_speed_and_never_enters_the_next_interval() {
        let mut meter = Meter::default();
        assert_eq!(meter.settle(35_000, 1_000).rate, None);
        stream(&mut meter, 5_000);
        let next = meter.settle(35_101, 7_000);
        assert_eq!(next.rate, Some(50.0));
        assert_eq!(next.average, Some(50.0));
        assert_eq!(next.measured_tokens, 100.0);
    }

    #[test]
    fn a_subsecond_flush_never_becomes_a_recent_sample_or_peak() {
        let mut meter = Meter::default();
        meter.delta(&"x".repeat(5_158), 0);
        let batch = meter.settle(5_158, 200);
        assert_eq!(batch.rate, None);
        assert_eq!(batch.peak, None);
        stream(&mut meter, 1_000);
        let next = meter.settle(5_259, 3_000);
        assert_eq!(next.rate, Some(50.0));
        assert_eq!(next.peak, Some(50.0));
    }

    #[test]
    fn a_large_first_packet_and_whole_tool_arguments_stay_out_of_the_measured_pace() {
        let mut meter = Meter::default();
        meter.delta(&"x".repeat(30_000), 0);
        meter.delta(&"x".repeat(100), 1_000);
        meter.unstreamed_tool(&"x".repeat(10_000));
        let speed = meter.settle(40_100, 2_000);
        assert_eq!(speed.rate, Some(50.0));
        assert_eq!(speed.measured_tokens, 100.0);
        assert_eq!(speed.peak, Some(50.0));
    }

    #[test]
    fn streamed_tool_arguments_are_calibrated_once_along_with_text_and_thinking() {
        let mut meter = Meter::default();
        stream(&mut meter, 0);
        meter.tool_delta(&"x".repeat(100), 2_000);
        meter.unstreamed_tool(&"x".repeat(100));
        assert_eq!(meter.settle(201, 4_000).rate, Some(50.0));
    }

    #[test]
    fn reasoning_that_never_streamed_never_becomes_visible_text_speed() {
        let mut meter = Meter::default();
        stream(&mut meter, 0);
        meter.reasoning_output(Some(10_000));
        assert_eq!(meter.settle(10_101, 2_000).rate, Some(50.0));
    }

    #[test]
    fn a_thinking_summary_opening_does_not_push_hidden_reasoning_into_text_speed() {
        let mut meter = Meter::default();
        meter.thinking_delta("a short summary", 0);
        meter.delta(&"x".repeat(100), 1_000);
        meter.reasoning_output(Some(10_000));
        let speed = meter.settle(10_100, 2_000);
        assert_eq!(speed.rate, Some(50.0));
        assert_eq!(speed.measured_tokens, 100.0);
    }

    #[test]
    fn thinking_and_visible_streams_use_their_own_reported_token_shares() {
        let mut meter = Meter::default();
        meter.thinking_delta(&"x".repeat(100), 0);
        meter.thinking_delta(&"x".repeat(100), 1_000);
        meter.delta(&"x".repeat(100), 2_000);
        meter.reasoning_output(Some(1_000));
        let speed = meter.settle(1_100, 4_000);
        assert_eq!(speed.measured_tokens, 600.0);
        assert_eq!(speed.rate, Some(150.0));
    }

    #[test]
    fn a_retry_starts_a_new_request_without_borrowing_unreported_generation_time() {
        let mut meter = Meter::default();
        stream(&mut meter, 0);
        meter.pause(10_000);
        meter.begin_request(30_000);
        stream(&mut meter, 40_000);
        assert_eq!(meter.settle(101, 42_000).rate, Some(50.0));
    }

    #[test]
    fn a_time_only_usage_refresh_keeps_its_elapsed_time_until_output_arrives() {
        let mut meter = Meter::default();
        stream(&mut meter, 0);
        assert_eq!(meter.settle(0, 10_000).rate, None);
        meter.start(11_000);
        let speed = meter.settle(606, 13_000);
        assert_eq!(speed.rate, Some(50.0));
        assert_eq!(speed.generation_ms, 12_000);
    }

    #[test]
    fn repeated_usage_and_unreported_output_keep_the_last_paired_average() {
        let mut meter = Meter::default();
        stream(&mut meter, 0);
        let measured = meter.settle(202, 2_000);
        assert_eq!(meter.settle(202, 5_000), measured);
        meter.start(10_000);
        let paused = meter.pause(12_000).unwrap();
        assert_eq!(paused.average, Some(100.0));
        assert_eq!(paused.generation_ms, 2_000);
        assert!(!paused.streaming);
    }
}
