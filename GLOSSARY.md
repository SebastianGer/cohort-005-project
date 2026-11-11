# Cadence

Cadence sells video courses to learners. This glossary pins down the language we use, in code, on screen and in email, for buying courses and getting money back.

## Buying

**Learner**:
A person who buys and takes a course. An instructor who buys someone else's course is a learner for that course.
_Avoid_: Student, User, Customer

**Instructor**:
The person who teaches a course. Being an instructor is tied to a specific course.

**Purchase**:
A learner's payment for one course, at the price they actually paid.
_Avoid_: Order, Transaction

**Team Licence**:
A Purchase that buys several Seats in one course for a team.

**Seat**:
One learner's access to a course, bought as part of a Team Licence.
_Avoid_: Coupon, Code

**Claimed**:
The state of a Seat that a team member has taken for themselves.
_Avoid_: Redeemed

**Team Leader**:
The member of a team who manages its Team Licence and hands out its Seats.
_Avoid_: Team admin, Team owner

## Running Cadence

**Admin**:
A Cadence staff member who runs the platform, including resolving Refund Requests. Being an Admin is not tied to any course or team.
_Avoid_: Team admin, Moderator, Staff

## Refunds

**Refund Request**:
An ask from the person who made a Purchase to get their money back for it, along with their reason.
_Avoid_: Cancellation, Reversal, Chargeback, Reversal request

**Requested**:
The state of a Refund Request that no one has approved or declined yet.
_Avoid_: Pending, Open

**Approved**:
The state of a Refund Request that an admin has accepted. Approval is the Refund: the Purchase becomes Refunded right away, whether or not the money has reached the learner yet.

**Declined**:
The state of a Refund Request that an admin has turned down. Nothing is returned and the learner keeps access.

**Resolved**:
A Refund Request that is no longer Requested, because it was Approved or Declined.

**Refund**:
The return of the full amount paid for a Purchase, following an Approved Refund Request. A Refund removes the learner's access to the course and erases their progress in it. A Team Licence is only ever refunded whole, and only while none of its Seats are Claimed.
_Avoid_: Reversal, Chargeback, Cancellation

**Refunded**:
The state of a Purchase that has had a Refund.
_Avoid_: Cancelled, Reversed

**Refund Eligibility**:
Whether a learner can still make a Refund Request for a Purchase. A learner whose Refund Request was Declined may make another one while they are still eligible. A learner who has already had a Refund for a course is never eligible again for that course; a Refund of a Team Licence does not count.
_Avoid_: Cancellation offer, Cancellable

**Refund Window**:
The fourteen calendar days after a Purchase during which a learner may make a Refund Request.
_Avoid_: Cancel window, cancellation window
