export interface RequestContext {
  callId: string;
  businessId: string;
  functionName: string;
  startTime: number;
  callerPhone: string;
}

export function createRequestContext(params: {
  callId: string;
  businessId: string;
  functionName: string;
  callerPhone: string;
}): RequestContext {
  return {
    callId: params.callId,
    businessId: params.businessId,
    functionName: params.functionName,
    callerPhone: params.callerPhone,
    startTime: Date.now(),
  };
}
