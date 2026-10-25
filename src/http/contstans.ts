export class StatusCodes {
  validation_failed = 400;
  not_found = 404;
  payload_too_long = 413;
}

export class ErrorMessages {
  payload_too_long = "Payload too large. Limit is 64KB."
  invalid_json = "Request body is invalid."
  missing_fields = "Request has missing fields";
  empty_json = "Empty JSON."
  not_found = "Not Found."
}
