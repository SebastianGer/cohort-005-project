# A Refund erases the learner's progress

When an Admin approves a Refund Request, we delete the learner's enrollment and their progress in the course (lesson progress, video watch history, quiz attempts and answers) rather than keeping it for a possible re-purchase. A learner who refunds a course almost certainly didn't value it, so a resume-where-you-left-off experience isn't worth carrying stale data for. We also chose not to snapshot the learner's progress onto the Refund Request: Admins are trusted to make the call, and we don't need an audit trail of usage.

## Consequences

- Erasing progress resets the completion and watch-time limits of Refund Eligibility, which would let a learner buy, watch, refund and repeat. To close that loop, a learner who has had a Refund for a personal Purchase of a course is never eligible for a Refund on that course again. A Team Licence Refund does not count towards this.
- Comments and course ratings are not progress and are kept.
