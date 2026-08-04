package com.tencent.mobileqq;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

/** Native offline entrypoint for the full OP authorization flow. */
public final class MainActivity extends Activity {
    private static final String DEFAULT_APP_ID = "1105602870";

    private EditText opDataInput;
    private TextView statusView;
    private boolean isAuthRequest;
    private String selectedAppId = DEFAULT_APP_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        opDataInput = findViewById(R.id.op_data_input);
        statusView = findViewById(R.id.status);
        Button submit = findViewById(R.id.submit);
        updateRequestMode(getIntent());
        submit.setOnClickListener(this::submit);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        updateRequestMode(intent);
    }

    private void updateRequestMode(Intent intent) {
        isAuthRequest = intent != null && intent.getBooleanExtra("is_auth_request", false);
        String requestedAppId = intent == null ? null : intent.getStringExtra("appid");
        selectedAppId = requestedAppId != null && requestedAppId.trim().matches("\\d+")
            ? requestedAppId.trim()
            : DEFAULT_APP_ID;
        statusView.setText(isAuthRequest
            ? getString(R.string.authorization_request, selectedAppId)
            : getString(R.string.standalone_instruction));
    }

    private void submit(View ignored) {
        String opData = opDataInput.getText().toString().trim();
        if (opData.isEmpty()) {
            Toast.makeText(this, R.string.op_required, Toast.LENGTH_SHORT).show();
            return;
        }

        final String wakeUrl;
        try {
            // This is validation plus local binary plist construction only; it never performs I/O.
            wakeUrl = OpWakeUrlBuilder.build(opData, selectedAppId);
        } catch (IllegalArgumentException error) {
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_SHORT).show();
            return;
        }

        if (isAuthRequest) {
            Intent result = new Intent();
            result.putExtra("op_data", opData);
            setResult(RESULT_OK, result);
            finish();
            return;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(wakeUrl)));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.wake_target_missing, Toast.LENGTH_LONG).show();
        }
    }
}
