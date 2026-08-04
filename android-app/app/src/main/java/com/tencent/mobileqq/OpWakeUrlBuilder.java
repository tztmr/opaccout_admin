package com.tencent.mobileqq;

import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Builds the same NSKeyedArchiver pasteboard payload as the server wake URL encoder. */
public final class OpWakeUrlBuilder {
    private static final String DEFAULT_ENCRY_TOKEN = "dd02c11302e09f85400b834bbd3ac04d";
    private static final String DEFAULT_PFKEY = "65d0a30bedbc73f53d8370141e6220df";

    private OpWakeUrlBuilder() {}

    public static String build(String opData, String appId) {
        String normalizedAppId = appId == null ? "" : appId.trim();
        if (!normalizedAppId.matches("\\d+")) {
            throw new IllegalArgumentException("项目 AppID 格式不正确");
        }

        OpToken token = parse(opData);
        String pasteboard = Base64.getEncoder().encodeToString(writeBinaryPlist(buildPasteboard(token)));
        return "tencent" + normalizedAppId
            + "://qzapp/mqzone/0?objectlocation=url&pasteboard="
            + URLEncoder.encode(pasteboard, StandardCharsets.UTF_8);
    }

    private static OpToken parse(String input) {
        String value = input == null ? "" : input.trim();
        String[] parts = value.split("\\|", -1);
        if (parts.length < 3 || parts.length > 5) throw invalidOp();

        String[] normalized = new String[parts.length];
        for (int index = 0; index < parts.length; index += 1) {
            normalized[index] = parts[index].trim();
            if (normalized[index].isEmpty()) throw invalidOp();
        }

        return new OpToken(
            normalized[0],
            normalized[1],
            normalized[2],
            normalized.length >= 4 ? normalized[3] : DEFAULT_PFKEY,
            normalized.length == 5 ? normalized[4] : ""
        );
    }

    private static IllegalArgumentException invalidOp() {
        return new IllegalArgumentException("OP 数据格式不正确，需要 3 到 5 个非空字段");
    }

    private static Map<String, Object> buildPasteboard(OpToken token) {
        List<Object> objects = new ArrayList<>();
        objects.add("$null");
        objects.add(dictionary(
            "$class", new Uid(30),
            "NS.keys", list(new Uid(2), new Uid(3), new Uid(4), new Uid(5), new Uid(6), new Uid(7), new Uid(8),
                new Uid(9), new Uid(10), new Uid(11), new Uid(12), new Uid(13), new Uid(14), new Uid(15)),
            "NS.objects", list(new Uid(16), new Uid(17), new Uid(18), new Uid(19), new Uid(21), new Uid(22), new Uid(23),
                new Uid(24), new Uid(25), new Uid(26), new Uid(27), new Uid(28), new Uid(29), new Uid(29))
        ));
        objects.add("expires_in");
        objects.add("appsign_bundlenull");
        objects.add("encrytoken");
        objects.add("passDataResp");
        objects.add("ret");
        objects.add("openid");
        objects.add("pf");
        objects.add("user_cancelled");
        objects.add("pfkey");
        objects.add("pay_token");
        objects.add("msg");
        objects.add("access_token");
        objects.add("auth_time");
        objects.add("expires_time");
        objects.add(7_776_000);
        objects.add("2");
        objects.add(DEFAULT_ENCRY_TOKEN);
        objects.add(dictionary("$class", new Uid(20), "NS.objects", list()));
        objects.add(dictionary("$classes", list("NSMutableArray", "NSArray", "NSObject"), "$classname", "NSMutableArray"));
        objects.add(0);
        objects.add(token.openid);
        objects.add("openmobile_ios");
        objects.add("NO");
        objects.add(token.pfKey);
        objects.add(token.payToken);
        objects.add("");
        objects.add(token.accessToken);
        objects.add(token.authTime);
        objects.add(dictionary("$classes", list("NSMutableDictionary", "NSDictionary", "NSObject"), "$classname", "NSMutableDictionary"));

        return dictionary(
            "$archiver", "NSKeyedArchiver",
            "$objects", objects,
            "$top", dictionary("root", new Uid(1)),
            "$version", 100_000
        );
    }

    private static Map<String, Object> dictionary(Object... entries) {
        Map<String, Object> dictionary = new LinkedHashMap<>();
        for (int index = 0; index < entries.length; index += 2) {
            dictionary.put((String) entries[index], entries[index + 1]);
        }
        return dictionary;
    }

    private static List<Object> list(Object... values) {
        List<Object> list = new ArrayList<>();
        for (Object value : values) list.add(value);
        return list;
    }

    private static byte[] writeBinaryPlist(Object root) {
        List<Object> objects = new ArrayList<>();
        IdentityHashMap<Object, Integer> identities = new IdentityHashMap<>();
        Map<String, Integer> primitiveIndexes = new LinkedHashMap<>();
        collect(root, objects, identities, primitiveIndexes);

        int refSize = byteSize(objects.size() - 1);
        List<byte[]> encodedObjects = new ArrayList<>();
        List<Integer> offsets = new ArrayList<>();
        int offset = 8;
        for (Object object : objects) {
            byte[] encoded = encodeObject(object, identities, primitiveIndexes, refSize);
            offsets.add(offset);
            encodedObjects.add(encoded);
            offset += encoded.length;
        }

        int offsetSize = byteSize(offset);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.writeBytes("bplist00".getBytes(StandardCharsets.US_ASCII));
        for (byte[] encoded : encodedObjects) output.writeBytes(encoded);
        for (int item : offsets) output.writeBytes(unsignedInteger(item, offsetSize));

        byte[] trailer = new byte[32];
        trailer[6] = (byte) offsetSize;
        trailer[7] = (byte) refSize;
        writeUnsigned(trailer, 8, objects.size(), 8);
        writeUnsigned(trailer, 16, 0, 8);
        writeUnsigned(trailer, 24, offset, 8);
        output.writeBytes(trailer);
        return output.toByteArray();
    }

    private static void collect(Object value, List<Object> objects, IdentityHashMap<Object, Integer> identities,
                                Map<String, Integer> primitiveIndexes) {
        if (value == null) return;
        if (isPrimitive(value)) {
            addPrimitive(value, objects, primitiveIndexes);
            return;
        }
        if (identities.containsKey(value)) return;

        identities.put(value, objects.size());
        objects.add(value);
        if (value instanceof List<?>) {
            for (Object item : (List<?>) value) collect(item, objects, identities, primitiveIndexes);
        } else if (value instanceof Map<?, ?>) {
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                collect(entry.getKey(), objects, identities, primitiveIndexes);
                collect(entry.getValue(), objects, identities, primitiveIndexes);
            }
        }
    }

    private static int addPrimitive(Object value, List<Object> objects, Map<String, Integer> primitiveIndexes) {
        String key = primitiveKey(value);
        Integer existing = primitiveIndexes.get(key);
        if (existing != null) return existing;
        int index = objects.size();
        objects.add(value);
        primitiveIndexes.put(key, index);
        return index;
    }

    private static byte[] encodeObject(Object value, IdentityHashMap<Object, Integer> identities,
                                       Map<String, Integer> primitiveIndexes, int refSize) {
        if (value instanceof String) return encodeAsciiString((String) value);
        if (value instanceof Number) return encodeInteger(((Number) value).longValue());
        if (value instanceof Uid) return encodeUid(((Uid) value).value);
        if (value instanceof List<?>) {
            List<?> values = (List<?>) value;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            output.writeBytes(encodeCount(0xA0, values.size()));
            for (Object item : values) output.writeBytes(unsignedInteger(refFor(item, identities, primitiveIndexes), refSize));
            return output.toByteArray();
        }
        if (value instanceof Map<?, ?>) {
            Map<?, ?> dictionary = (Map<?, ?>) value;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            output.writeBytes(encodeCount(0xD0, dictionary.size()));
            for (Object key : dictionary.keySet()) output.writeBytes(unsignedInteger(refFor(key, identities, primitiveIndexes), refSize));
            for (Object item : dictionary.values()) output.writeBytes(unsignedInteger(refFor(item, identities, primitiveIndexes), refSize));
            return output.toByteArray();
        }
        return new byte[] { 0 };
    }

    private static int refFor(Object value, IdentityHashMap<Object, Integer> identities, Map<String, Integer> primitiveIndexes) {
        Integer index = isPrimitive(value) ? primitiveIndexes.get(primitiveKey(value)) : identities.get(value);
        if (index == null) throw new IllegalStateException("Missing plist reference");
        return index;
    }

    private static boolean isPrimitive(Object value) {
        return value instanceof String || value instanceof Number || value instanceof Uid;
    }

    private static String primitiveKey(Object value) {
        if (value instanceof Uid) return "uid:" + ((Uid) value).value;
        if (value instanceof String) return "string:" + value;
        return "number:" + value;
    }

    private static byte[] encodeAsciiString(String value) {
        byte[] data = value.getBytes(StandardCharsets.US_ASCII);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.writeBytes(encodeCount(0x50, data.length));
        output.writeBytes(data);
        return output.toByteArray();
    }

    private static byte[] encodeInteger(long value) {
        int size = byteSize(value);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write(0x10 + log2(size));
        output.writeBytes(unsignedInteger(value, size));
        return output.toByteArray();
    }

    private static byte[] encodeUid(long value) {
        int size = byteSize(value);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write(0x80 + size - 1);
        output.writeBytes(unsignedInteger(value, size));
        return output.toByteArray();
    }

    private static byte[] encodeCount(int markerBase, int count) {
        if (count < 15) return new byte[] { (byte) (markerBase + count) };
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write(markerBase + 15);
        output.writeBytes(encodeInteger(count));
        return output.toByteArray();
    }

    private static int byteSize(long value) {
        if (value <= 0xFFL) return 1;
        if (value <= 0xFFFFL) return 2;
        if (value <= 0xFFFFFFFFL) return 4;
        return 8;
    }

    private static int log2(int value) {
        return Integer.numberOfTrailingZeros(value);
    }

    private static byte[] unsignedInteger(long value, int size) {
        byte[] result = new byte[size];
        writeUnsigned(result, 0, value, size);
        return result;
    }

    private static void writeUnsigned(byte[] target, int start, long value, int size) {
        for (int index = size - 1; index >= 0; index -= 1) {
            target[start + index] = (byte) (value & 0xFF);
            value >>>= 8;
        }
    }

    private static final class Uid {
        final long value;

        Uid(long value) {
            this.value = value;
        }
    }

    private static final class OpToken {
        final String openid;
        final String accessToken;
        final String payToken;
        final String pfKey;
        final String authTime;

        OpToken(String openid, String accessToken, String payToken, String pfKey, String authTime) {
            this.openid = openid;
            this.accessToken = accessToken;
            this.payToken = payToken;
            this.pfKey = pfKey;
            this.authTime = authTime;
        }
    }
}
