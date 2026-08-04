package com.tencent.mobileqq;

/** Validated sensitive data returned by the public short-OP resolver. */
public record ShortOpResponse(String code, String opData, String wakeUrl) {}
