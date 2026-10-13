export class StatusCodes {
  client_error = "client_error";
  not_authorized = "not_authorized";
  not_allowed = "not_allowed";
  not_here = "not_here";
  state_conflict = "state_conflict";
  semantically_error = "semantically_error";
  slow_down = "slow_down";
  internal = "internal";
}

export class ErrorMessages {
  not_here = "this endpoint not found";
  client_error = "body or data missing!";
  not_authorized = "you are not authorized on this data.";
  not_allowed = "you are not allowed for this data.";
  state_conflict = "There is a state conflict here.";
  semantically_error = "There is a semantical error here.";
  slow_down = "Too many requests there.";
  internal = "Server error";
}
