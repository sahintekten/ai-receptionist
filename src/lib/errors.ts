export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class BusinessNotFoundError extends AppError {
  constructor(identifier: string) {
    super(
      `Business not found: ${identifier}`,
      "BUSINESS_NOT_FOUND",
      404
    );
    this.name = "BusinessNotFoundError";
  }
}

export class IntegrationError extends AppError {
  constructor(integration: string, message: string, context?: Record<string, unknown>) {
    super(
      `${integration} error: ${message}`,
      "INTEGRATION_ERROR",
      502,
      context
    );
    this.name = "IntegrationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Invalid webhook signature") {
    super(message, "AUTH_ERROR", 401);
    this.name = "AuthenticationError";
  }
}

export class BookingOwnershipError extends AppError {
  constructor() {
    super(
      "Booking does not belong to this business/caller",
      "BOOKING_OWNERSHIP_ERROR",
      403
    );
    this.name = "BookingOwnershipError";
  }
}

export class LookupRequiredError extends AppError {
  constructor(action: string) {
    super(
      `lookup_bookings required before ${action}`,
      "LOOKUP_REQUIRED",
      400
    );
    this.name = "LookupRequiredError";
  }
}
