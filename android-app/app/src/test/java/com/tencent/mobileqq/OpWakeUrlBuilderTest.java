package com.tencent.mobileqq;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.io.File;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.xml.parsers.DocumentBuilderFactory;

import org.w3c.dom.Document;
import org.w3c.dom.Element;

public class OpWakeUrlBuilderTest {
    public static void main(String[] args) throws Exception {
        buildsDouyinWakeUrlWithEveryFullOpFieldInTheBinaryPasteboard();
        acceptsThreeToFiveNonEmptySegments();
        rejectsMalformedOrIncompleteOpSegments();
        rejectsNonNumericAppIds();
        declaresARegularLauncherIcon();
        System.out.println("OpWakeUrlBuilder offline contract passed");
    }

    private static void buildsDouyinWakeUrlWithEveryFullOpFieldInTheBinaryPasteboard() throws Exception {
        String url = build("fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418", "1105602870");

        require(url.startsWith("tencent1105602870://qzapp/mqzone/0?objectlocation=url&pasteboard="), "must use the Tencent wake URL protocol");
        String pasteboard = new URI(url).getRawQuery().substring("objectlocation=url&pasteboard=".length());
        byte[] payload = Base64.getDecoder().decode(URLDecoder.decode(pasteboard, StandardCharsets.UTF_8));
        BplistArchive archive = BplistArchive.parse(payload);
        require(archive.offsetSize >= 1 && archive.offsetSize <= 8, "trailer must declare a valid offset size");
        require(archive.refSize >= 1 && archive.refSize <= 8, "trailer must declare a valid reference size");
        require(archive.offsets.length > 30, "trailer must describe the complete archived object table");
        for (int index = 1; index < archive.offsets.length; index += 1) {
            require(archive.offsets[index] > archive.offsets[index - 1], "object offsets must be strictly increasing");
        }

        DictNode root = archive.dictionary(archive.node(archive.topObject));
        requireEquals("NSKeyedArchiver", archive.string(root.value("$archiver")), "must use NSKeyedArchiver");
        requireEquals(100000L, archive.integer(root.value("$version")), "archiver version must match the reference contract");

        ArrayNode archivedObjects = archive.array(root.value("$objects"));
        require(archivedObjects.values.size() >= 31, "archive must expose the keyed object graph");
        DictNode response = archive.dictionary(archivedObjects.values.get(1));
        DictNode responseClass = archive.dictionary(archive.logical(archivedObjects, response.value("$class")));
        requireEquals("NSMutableDictionary", archive.string(responseClass.value("$classname")), "root response must be a mutable dictionary");

        Map<String, Node> values = archive.keyedValues(archivedObjects, response);
        requireEquals(7776000L, archive.integer(values.get("expires_in")), "expires_in must retain the reference value");
        requireEquals("2", archive.string(values.get("appsign_bundlenull")), "appsign_bundlenull must retain the reference value");
        require(archive.string(values.get("encrytoken")).length() > 0, "protocol encrytoken must be present without asserting a secret literal");
        requireEquals(0L, archive.integer(values.get("ret")), "ret must be successful");
        requireEquals("fixture-openid", archive.string(values.get("openid")), "openid must survive archive encoding");
        requireEquals("openmobile_ios", archive.string(values.get("pf")), "pf must retain the reference value");
        requireEquals("NO", archive.string(values.get("user_cancelled")), "user_cancelled must retain the reference value");
        requireEquals("fixture-pfkey", archive.string(values.get("pfkey")), "pfkey must survive archive encoding");
        requireEquals("fixture-pay", archive.string(values.get("pay_token")), "pay_token must survive archive encoding");
        requireEquals("", archive.string(values.get("msg")), "msg must retain the reference value");
        requireEquals("fixture-access", archive.string(values.get("access_token")), "access_token must survive archive encoding");
        requireEquals("1782303418", archive.string(values.get("auth_time")), "auth_time must survive archive encoding");
        requireEquals("1782303418", archive.string(values.get("expires_time")), "expires_time must match auth_time");
    }

    private static void acceptsThreeToFiveNonEmptySegments() throws Exception {
        require(build("open|access|pay", "1105602870").startsWith("tencent1105602870://"), "three segments must be accepted");
        require(build("open|access|pay|pf", "1105602870").startsWith("tencent1105602870://"), "four segments must be accepted");
        require(build("open|access|pay|pf|1782303418", "1105602870").startsWith("tencent1105602870://"), "five segments must be accepted");
    }

    private static void rejectsMalformedOrIncompleteOpSegments() {
        assertInvalid("bad");
        assertInvalid("open|access");
        assertInvalid("open|access|pay|");
        assertInvalid("open|access||pf");
        assertInvalid("open|access|pay|pf|1782303418|extra");
    }

    private static void rejectsNonNumericAppIds() {
        assertInvalidAppId();
    }

    private static void declaresARegularLauncherIcon() throws Exception {
        File manifest = new File("src/main/AndroidManifest.xml");
        require(manifest.isFile(), "launcher manifest must exist");
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document document = factory.newDocumentBuilder().parse(manifest);
        Element application = (Element) document.getElementsByTagName("application").item(0);
        require(application != null, "manifest must contain application");
        String namespace = "http://schemas.android.com/apk/res/android";
        requireEquals("@mipmap/ic_launcher", application.getAttributeNS(namespace, "icon"), "application must declare a launcher icon");
        requireEquals("@mipmap/ic_launcher_round", application.getAttributeNS(namespace, "roundIcon"), "application must declare a round launcher icon");
    }

    private static void assertInvalid(String value) {
        try {
            build(value, "1105602870");
            throw new AssertionError("expected invalid OP input to be rejected: " + value);
        } catch (IllegalArgumentException expected) {
            // Expected contract behavior.
        } catch (Exception error) {
            throw new AssertionError(error);
        }
    }

    private static void assertInvalidAppId() {
        try {
            build("open|access|pay", "not-an-app-id");
            throw new AssertionError("expected a nonnumeric AppID to be rejected");
        } catch (IllegalArgumentException expected) {
            // Expected contract behavior.
        } catch (Exception error) {
            throw new AssertionError(error);
        }
    }

    private static String build(String opData, String appId) throws Exception {
        Method method;
        try {
            method = Class.forName("com.tencent.mobileqq.OpWakeUrlBuilder").getMethod("build", String.class, String.class);
        } catch (ClassNotFoundException | NoSuchMethodException error) {
            throw new AssertionError("OpWakeUrlBuilder.build must exist for offline OP authorization: " + error.getClass().getSimpleName(), error);
        }

        try {
            Object value = method.invoke(null, opData, appId);
            require(value != null, "builder must return a wake URL");
            require(value.getClass().equals(String.class), "builder must return a String");
            return (String) value;
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof IllegalArgumentException) throw (IllegalArgumentException) cause;
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            throw new AssertionError(cause);
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void requireEquals(Object expected, Object actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    private interface Node {}

    private static final class StringNode implements Node {
        final String value;
        StringNode(String value) { this.value = value; }
    }

    private static final class IntegerNode implements Node {
        final long value;
        IntegerNode(long value) { this.value = value; }
    }

    private static final class UidNode implements Node {
        final int value;
        UidNode(int value) { this.value = value; }
    }

    private static final class ArrayNode implements Node {
        final List<Node> values;
        ArrayNode(List<Node> values) { this.values = values; }
    }

    private static final class DictNode implements Node {
        final Map<String, Node> values;
        DictNode(Map<String, Node> values) { this.values = values; }
        Node value(String key) {
            Node value = values.get(key);
            if (value == null) throw new AssertionError("archive is missing key: " + key);
            return value;
        }
    }

    /** Minimal read-only parser for the plist node kinds produced by OpWakeUrlBuilder. */
    private static final class BplistArchive {
        final byte[] bytes;
        final int offsetSize;
        final int refSize;
        final int topObject;
        final int[] offsets;
        final Node[] cache;

        private BplistArchive(byte[] bytes, int offsetSize, int refSize, int topObject, int[] offsets) {
            this.bytes = bytes;
            this.offsetSize = offsetSize;
            this.refSize = refSize;
            this.topObject = topObject;
            this.offsets = offsets;
            this.cache = new Node[offsets.length];
        }

        static BplistArchive parse(byte[] bytes) {
            require(bytes.length > 40, "binary plist must include header, objects, offsets, and trailer");
            requireEquals("bplist00", new String(bytes, 0, 8, StandardCharsets.US_ASCII), "binary plist magic must be valid");
            int trailer = bytes.length - 32;
            int offsetSize = unsigned(bytes[trailer + 6]);
            int refSize = unsigned(bytes[trailer + 7]);
            long objectCount = readUnsigned(bytes, trailer + 8, 8);
            long topObject = readUnsigned(bytes, trailer + 16, 8);
            long offsetTable = readUnsigned(bytes, trailer + 24, 8);
            require(objectCount > 0 && objectCount <= Integer.MAX_VALUE, "trailer object count must be valid");
            require(topObject >= 0 && topObject < objectCount, "trailer top object must be valid");
            require(offsetSize >= 1 && offsetSize <= 8 && refSize >= 1 && refSize <= 8, "trailer sizes must be valid");
            require(offsetTable >= 8 && offsetTable + objectCount * offsetSize == trailer, "offset table must exactly precede trailer");

            int[] offsets = new int[(int) objectCount];
            for (int index = 0; index < offsets.length; index += 1) {
                long offset = readUnsigned(bytes, (int) offsetTable + index * offsetSize, offsetSize);
                require(offset >= 8 && offset < offsetTable, "every object offset must point before the offset table");
                offsets[index] = (int) offset;
            }
            return new BplistArchive(bytes, offsetSize, refSize, (int) topObject, offsets);
        }

        Node node(int index) {
            if (index < 0 || index >= offsets.length) throw new AssertionError("plist reference is outside object table");
            if (cache[index] == null) cache[index] = parseNode(offsets[index]);
            return cache[index];
        }

        Node parseNode(int position) {
            int marker = unsigned(bytes[position]);
            int kind = marker & 0xF0;
            int info = marker & 0x0F;
            if (kind == 0x10) return new IntegerNode(readUnsigned(bytes, position + 1, 1 << info));
            if (kind == 0x50) {
                Count count = count(position, info);
                return new StringNode(new String(bytes, count.dataStart, count.value, StandardCharsets.US_ASCII));
            }
            if (kind == 0x80) return new UidNode((int) readUnsigned(bytes, position + 1, info + 1));
            if (kind == 0xA0) {
                Count count = count(position, info);
                List<Node> values = new ArrayList<>();
                for (int index = 0; index < count.value; index += 1) values.add(node((int) readUnsigned(bytes, count.dataStart + index * refSize, refSize)));
                return new ArrayNode(values);
            }
            if (kind == 0xD0) {
                Count count = count(position, info);
                Map<String, Node> values = new HashMap<>();
                int keysStart = count.dataStart;
                int valuesStart = keysStart + count.value * refSize;
                for (int index = 0; index < count.value; index += 1) {
                    String key = string(node((int) readUnsigned(bytes, keysStart + index * refSize, refSize)));
                    values.put(key, node((int) readUnsigned(bytes, valuesStart + index * refSize, refSize)));
                }
                return new DictNode(values);
            }
            throw new AssertionError("unsupported plist marker: " + marker);
        }

        Count count(int position, int info) {
            if (info < 15) return new Count(info, position + 1);
            int integerMarker = unsigned(bytes[position + 1]);
            require((integerMarker & 0xF0) == 0x10, "extended count must be encoded as an integer");
            int size = 1 << (integerMarker & 0x0F);
            long count = readUnsigned(bytes, position + 2, size);
            require(count <= Integer.MAX_VALUE, "plist count must be in test parser range");
            return new Count((int) count, position + 2 + size);
        }

        DictNode dictionary(Node node) {
            require(node instanceof DictNode, "plist node must be a dictionary");
            return (DictNode) node;
        }

        ArrayNode array(Node node) {
            require(node instanceof ArrayNode, "plist node must be an array");
            return (ArrayNode) node;
        }

        String string(Node node) {
            require(node instanceof StringNode, "plist node must be a string");
            return ((StringNode) node).value;
        }

        long integer(Node node) {
            require(node instanceof IntegerNode, "plist node must be an integer");
            return ((IntegerNode) node).value;
        }

        Node logical(ArrayNode archivedObjects, Node node) {
            require(node instanceof UidNode, "NSKeyedArchiver references must use UIDs");
            int index = ((UidNode) node).value;
            require(index >= 0 && index < archivedObjects.values.size(), "NSKeyedArchiver UID must be in object array");
            return archivedObjects.values.get(index);
        }

        Map<String, Node> keyedValues(ArrayNode archivedObjects, DictNode response) {
            ArrayNode keys = array(response.value("NS.keys"));
            ArrayNode values = array(response.value("NS.objects"));
            requireEquals(keys.values.size(), values.values.size(), "NS.keys and NS.objects must have equal length");
            Map<String, Node> result = new HashMap<>();
            for (int index = 0; index < keys.values.size(); index += 1) {
                result.put(string(logical(archivedObjects, keys.values.get(index))), logical(archivedObjects, values.values.get(index)));
            }
            return result;
        }

        static int unsigned(byte value) { return value & 0xFF; }

        static long readUnsigned(byte[] bytes, int start, int size) {
            require(start >= 0 && size >= 1 && start + size <= bytes.length, "plist read must stay in bounds");
            long value = 0;
            for (int index = 0; index < size; index += 1) value = (value << 8) | unsigned(bytes[start + index]);
            return value;
        }
    }

    private static final class Count {
        final int value;
        final int dataStart;
        Count(int value, int dataStart) {
            this.value = value;
            this.dataStart = dataStart;
        }
    }
}
