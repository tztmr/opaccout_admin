package com.tencent.open.agent;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import com.tencent.mobileqq.MainActivity;
import com.tencent.mobileqq.R;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * QQ SDK-compatible callback bridge. It receives OP data from MainActivity and returns the
 * reference project's key_response object to the game that started this activity.
 */
public final class AgentActivity extends Activity {
    private static final int AUTH_REQUEST_CODE = 1000;
    private static final String DEFAULT_PFKEY = "65d0a30bedbc73f53d8370141e6220df";
    private String appId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        appId = getIntent().getStringExtra("appid");

        Intent request = new Intent(this, MainActivity.class);
        request.putExtra("appid", appId);
        request.putExtra("is_auth_request", true);
        startActivityForResult(request, AUTH_REQUEST_CODE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != AUTH_REQUEST_CODE) return;
        if (resultCode == RESULT_OK && data != null) {
            String opData = data.getStringExtra("op_data");
            if (opData != null && !opData.trim().isEmpty() && beginIntoGame(opData)) return;
        }
        finish();
    }

    private boolean beginIntoGame(String opData) {
        String[] values = normalizeOp(opData);
        if (values == null) {
            Toast.makeText(this, R.string.op_invalid, Toast.LENGTH_SHORT).show();
            return false;
        }

        JSONObject response = new JSONObject();
        try {
            response.put("openid", values[0]);
            response.put("access_token", values[1]);
            response.put("pay_token", values[2]);
            response.put("pfkey", values[3]);
            response.put("auth_time", values[4]);
            response.put("expires_in", "7776000");
            response.put("ret", "0");
            response.put("pf", "desktop_m_qq-10000144-android-2002-");
            response.put("page_type", "1");
            response.put("expires_time", values[4]);
        } catch (JSONException error) {
            return false;
        }

        Intent result = new Intent();
        result.putExtra("key_response", response.toString());
        setResult(RESULT_OK, result);
        finish();
        return true;
    }

    private static String[] normalizeOp(String opData) {
        String[] parts = opData.replaceAll("\\s", "").split("\\|", -1);
        if (parts.length < 3 || parts.length > 5) return null;
        for (String part : parts) if (part.isEmpty()) return null;

        return new String[] {
            parts[0],
            parts[1],
            parts[2],
            parts.length >= 4 ? parts[3] : DEFAULT_PFKEY,
            parts.length == 5 ? parts[4] : ""
        };
    }
}
